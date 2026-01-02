import { Router, Request, Response } from 'express';
import { getAuthUrl, getTokensFromCode } from '../../services/gmail/oauth';
import { query, transaction } from '../../db/connection';
import { encrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { GmailClient } from '../../services/gmail/client';

const router = Router();

/**
 * GET /auth/gmail
 * Initiate Gmail OAuth flow
 */
router.get('/gmail', (req: Request, res: Response) => {
  const state = req.query.state as string | undefined;
  const authUrl = getAuthUrl(state);
  res.redirect(authUrl);
});

/**
 * GET /auth/callback
 * Handle OAuth callback
 */
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const error = req.query.error as string | undefined;

  if (error) {
    logger.error('OAuth error', { error });
    return res.status(400).json({ error: 'OAuth authorization failed' });
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    // Exchange code for tokens
    const tokens = await getTokensFromCode(code);

    // Get user profile from Gmail
    const gmailClient = new GmailClient(
      tokens.access_token,
      tokens.refresh_token,
      'temp'
    );
    const profile = await gmailClient.getProfile();

    if (!profile.emailAddress) {
      throw new Error('No email address in profile');
    }

    // Store or update user
    await transaction(async (client) => {
      // Check if user exists
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email = $1`,
        [profile.emailAddress]
      );

      if (existing.length > 0) {
        // Update existing user
        await client.query(
          `
          UPDATE users
          SET
            gmail_access_token = $1,
            gmail_refresh_token = $2,
            gmail_token_expires_at = $3,
            gmail_history_id = $4,
            updated_at = NOW()
          WHERE id = $5
          `,
          [
            encrypt(tokens.access_token),
            tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
            tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            profile.historyId || null,
            existing[0].id,
          ]
        );
      } else {
        // Create new user
        await client.query(
          `
          INSERT INTO users (
            email, gmail_access_token, gmail_refresh_token,
            gmail_token_expires_at, gmail_history_id
          ) VALUES ($1, $2, $3, $4, $5)
          `,
          [
            profile.emailAddress,
            encrypt(tokens.access_token),
            tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
            tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            profile.historyId || null,
          ]
        );
      }
    });

    res.json({
      success: true,
      message: 'Gmail connected successfully',
      email: profile.emailAddress,
    });
  } catch (error) {
    logger.error('Failed to handle OAuth callback', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to complete OAuth flow' });
  }
});

export default router;

