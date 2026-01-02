import { GmailClient } from './client';
import { query, transaction } from '../../db/connection';
import { emailProcessQueue, EmailProcessJobData } from '../../queue';
import { logger } from '../../utils/logger';
import { decrypt } from '../../utils/encryption';
import { refreshAccessToken } from './oauth';
import { encrypt } from '../../utils/encryption';

/**
 * Gmail Sync Service
 * 
 * Handles incremental sync using historyId
 */
export class GmailSyncService {
  /**
   * Sync emails for a user (incremental or full)
   */
  async syncUserEmails(userId: string, maxResults: number = 100): Promise<void> {
    const syncLogger = logger.child({ userId });

    try {
      // Get user's Gmail tokens and historyId
      const user = await query<{
        gmail_access_token: string;
        gmail_refresh_token: string | null;
        gmail_history_id: string | null;
        gmail_token_expires_at: Date | null;
      }>(
        `SELECT gmail_access_token, gmail_refresh_token, gmail_history_id, gmail_token_expires_at
         FROM users WHERE id = $1`,
        [userId]
      );

      if (user.length === 0) {
        throw new Error(`User not found: ${userId}`);
      }

      let accessToken = decrypt(user[0].gmail_access_token);
      const refreshToken = user[0].gmail_refresh_token
        ? decrypt(user[0].gmail_refresh_token)
        : null;

      // Refresh token if expired
      if (user[0].gmail_token_expires_at && new Date(user[0].gmail_token_expires_at) < new Date()) {
        if (!refreshToken) {
          throw new Error('Access token expired and no refresh token available');
        }
        const refreshed = await refreshAccessToken(refreshToken);
        accessToken = refreshed.access_token;

        // Update tokens in database
        await query(
          `UPDATE users SET gmail_access_token = $1, gmail_token_expires_at = $2 WHERE id = $3`,
          [encrypt(accessToken), new Date(refreshed.expiry_date), userId]
        );
      }

      const gmailClient = new GmailClient(accessToken, refreshToken, userId);

      // Incremental sync if historyId exists
      if (user[0].gmail_history_id) {
        await this.incrementalSync(gmailClient, userId, user[0].gmail_history_id);
      } else {
        // Full sync
        await this.fullSync(gmailClient, userId, maxResults);
      }

      // Update historyId
      const profile = await gmailClient.getProfile();
      if (profile.historyId) {
        await query(
          `UPDATE users SET gmail_history_id = $1 WHERE id = $2`,
          [profile.historyId, userId]
        );
      }

      syncLogger.info('Gmail sync completed', { historyId: profile.historyId });
    } catch (error) {
      syncLogger.error('Gmail sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Incremental sync using historyId
   */
  private async incrementalSync(
    gmailClient: GmailClient,
    userId: string,
    historyId: string
  ): Promise<void> {
    const history = await gmailClient.getHistory(historyId, 100);

    for (const historyItem of history.history) {
      if (historyItem.messagesAdded) {
        for (const messageAdded of historyItem.messagesAdded) {
          if (messageAdded.message?.id) {
            await this.processMessage(gmailClient, userId, messageAdded.message.id);
          }
        }
      }
    }
  }

  /**
   * Full sync (fetch recent messages)
   */
  private async fullSync(
    gmailClient: GmailClient,
    userId: string,
    maxResults: number
  ): Promise<void> {
    const result = await gmailClient.listMessages({
      maxResults,
      q: 'has:youtube OR youtube.com OR youtu.be', // Filter for emails with YouTube links
    });

    for (const message of result.messages) {
      await this.processMessage(gmailClient, userId, message.id);
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(
    gmailClient: GmailClient,
    userId: string,
    messageId: string
  ): Promise<void> {
    try {
      const message = await gmailClient.getMessage(messageId);
      const metadata = gmailClient.extractMetadata(message);

      // Enqueue email processing job
      await emailProcessQueue.add('process', {
        userId,
        messageId: metadata.messageId,
        threadId: metadata.threadId,
        metadata: {
          senderEmail: metadata.senderEmail,
          senderName: metadata.senderName,
          subject: metadata.subject,
          receivedAt: metadata.receivedAt.toISOString(),
          snippet: metadata.snippet,
          labels: metadata.labels,
        },
      });
    } catch (error) {
      logger.error('Failed to process message', {
        userId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

