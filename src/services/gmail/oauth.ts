import { google } from 'googleapis';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const oauth2Client = new google.auth.OAuth2(
  config.gmail.clientId,
  config.gmail.clientSecret,
  config.gmail.redirectUri
);

export function getAuthUrl(state?: string): string {
  const scopes = config.gmail.scopes;
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent to get refresh token
    state,
  });
}

export async function getTokensFromCode(code: string): Promise<{
  access_token: string;
  refresh_token: string | null;
  expiry_date: number | null;
}> {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.access_token) {
      throw new Error('No access token received');
    }
    
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expiry_date: tokens.expiry_date || null,
    };
  } catch (error) {
    logger.error('Failed to exchange code for tokens', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function createOAuthClient(
  accessToken: string,
  refreshToken?: string
): typeof oauth2Client {
  const client = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri
  );
  
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  
  return client;
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expiry_date: number }> {
  const client = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri
  );
  
  client.setCredentials({
    refresh_token: refreshToken,
  });
  
  try {
    const { credentials } = await client.refreshAccessToken();
    
    if (!credentials.access_token) {
      throw new Error('No access token received from refresh');
    }
    
    return {
      access_token: credentials.access_token,
      expiry_date: credentials.expiry_date || Date.now() + 3600000,
    };
  } catch (error) {
    logger.error('Failed to refresh access token', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

