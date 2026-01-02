import { GmailClient } from '../services/gmail/client';
import { extractAndCanonicalize } from '../services/url/extractor';
import { query, transaction } from '../db/connection';
import { videoEnrichQueue, EmailProcessJobData } from '../queue';
import { logger } from '../utils/logger';
import { decrypt } from '../utils/encryption';

/**
 * Email Processor Worker
 * 
 * Processes Gmail messages:
 * 1. Fetch message from Gmail API
 * 2. Extract metadata
 * 3. Extract and canonicalize YouTube URLs
 * 4. Store email and links
 * 5. Enqueue video enrichment jobs
 */
export async function processEmailJob(jobData: EmailProcessJobData): Promise<void> {
  const { userId, messageId, threadId, metadata } = jobData;
  const jobLogger = logger.child({ jobId: `email-${messageId}`, userId });

  try {
    // Check if email already processed (idempotency)
    const existing = await query<{ id: string }>(
      `SELECT id FROM emails WHERE user_id = $1 AND gmail_message_id = $2`,
      [userId, messageId]
    );

    if (existing.length > 0) {
      jobLogger.info('Email already processed, skipping', { messageId });
      return;
    }

    // Get user's Gmail tokens
    const user = await query<{
      gmail_access_token: string;
      gmail_refresh_token: string | null;
    }>(`SELECT gmail_access_token, gmail_refresh_token FROM users WHERE id = $1`, [userId]);

    if (user.length === 0) {
      throw new Error(`User not found: ${userId}`);
    }

    const accessToken = decrypt(user[0].gmail_access_token);
    const refreshToken = user[0].gmail_refresh_token
      ? decrypt(user[0].gmail_refresh_token)
      : null;

    // Create Gmail client and fetch message
    const gmailClient = new GmailClient(accessToken, refreshToken, userId);
    const message = await gmailClient.getMessage(messageId);

    // Extract full text from message parts
    const messageText = extractMessageText(message);

    // Extract and canonicalize YouTube URLs
    const canonicalizedUrls = extractAndCanonicalize(messageText);

    if (canonicalizedUrls.length === 0) {
      jobLogger.info('No YouTube URLs found in email', { messageId });
      // Still store the email for completeness
      await storeEmail(userId, messageId, threadId, metadata);
      return;
    }

    // Store email and links in transaction
    await transaction(async (client) => {
      // Store email
      const emailResult = await client.query(
        `
        INSERT INTO emails (
          user_id, gmail_message_id, thread_id,
          sender_email, sender_name, subject,
          received_at, snippet, labels,
          is_thread_reply, thread_reply_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
        `,
        [
          userId,
          messageId,
          threadId,
          metadata.senderEmail,
          metadata.senderName || null,
          metadata.subject || null,
          new Date(metadata.receivedAt),
          metadata.snippet,
          metadata.labels,
          metadata.labels.includes('SENT') ? false : true, // Simplified
          metadata.labels.length, // Simplified thread reply count
        ]
      );

      const emailId = emailResult.rows[0].id;

      // Store YouTube links
      const linkIds: string[] = [];
      for (const url of canonicalizedUrls) {
        // Check if video already seen by this user (deduplication)
        const existingLink = await client.query(
          `
          SELECT id FROM youtube_links
          WHERE user_id = $1 AND video_id = $2
          LIMIT 1
          `,
          [userId, url.videoId]
        );

        const isDuplicate = existingLink.rows.length > 0;

        const linkResult = await client.query(
          `
          INSERT INTO youtube_links (
            user_id, email_id, canonical_url,
            video_id, playlist_id, is_duplicate
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (user_id, email_id, video_id) DO NOTHING
          RETURNING id
          `,
          [
            userId,
            emailId,
            url.canonicalUrl,
            url.videoId,
            url.playlistId || null,
            isDuplicate,
          ]
        );

        if (linkResult.rows.length > 0) {
          linkIds.push(linkResult.rows[0].id);
        }
      }

      // Update sender stats
      await client.query(
        `
        INSERT INTO sender_stats (user_id, sender_email, email_count, last_email_at)
        VALUES ($1, $2, 1, $3)
        ON CONFLICT (user_id, sender_email)
        DO UPDATE SET
          email_count = sender_stats.email_count + 1,
          last_email_at = GREATEST(sender_stats.last_email_at, EXCLUDED.last_email_at),
          updated_at = NOW()
        `,
        [userId, metadata.senderEmail, new Date(metadata.receivedAt)]
      );

      // Enqueue video enrichment jobs
      for (const linkId of linkIds) {
        const url = canonicalizedUrls.find((u) => u.videoId);
        if (url) {
          await videoEnrichQueue.add('enrich', {
            userId,
            linkId,
            videoId: url.videoId,
          });
        }
      }
    });

    jobLogger.info('Email processed successfully', {
      messageId,
      linksExtracted: canonicalizedUrls.length,
    });
  } catch (error) {
    jobLogger.error('Failed to process email', {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Extract text content from Gmail message parts
 */
function extractMessageText(message: any): string {
  let text = '';

  const extractPart = (part: any): void => {
    if (part.body?.data) {
      const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
      text += decoded + ' ';
    }

    if (part.parts) {
      for (const subPart of part.parts) {
        extractPart(subPart);
      }
    }
  };

  if (message.payload) {
    extractPart(message.payload);
  }

  return text;
}

/**
 * Store email metadata
 */
async function storeEmail(
  userId: string,
  messageId: string,
  threadId: string,
  metadata: EmailProcessJobData['metadata']
): Promise<void> {
  await query(
    `
    INSERT INTO emails (
      user_id, gmail_message_id, thread_id,
      sender_email, sender_name, subject,
      received_at, snippet, labels
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (user_id, gmail_message_id) DO NOTHING
    `,
    [
      userId,
      messageId,
      threadId,
      metadata.senderEmail,
      metadata.senderName || null,
      metadata.subject || null,
      new Date(metadata.receivedAt),
      metadata.snippet,
      metadata.labels,
    ]
  );
}

