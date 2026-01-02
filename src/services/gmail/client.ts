import { gmail_v1, google } from 'googleapis';
import { createOAuthClient } from './oauth';
import { logger } from '../../utils/logger';
import { config } from '../../config';

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  payload?: gmail_v1.Schema$MessagePart;
  labelIds?: string[];
  internalDate?: string;
}

export interface GmailMessageMetadata {
  messageId: string;
  threadId: string;
  senderEmail: string;
  senderName?: string;
  subject?: string;
  receivedAt: Date;
  snippet: string;
  labels: string[];
}

export class GmailClient {
  private gmail: gmail_v1.Gmail;
  private userId: string;

  constructor(accessToken: string, refreshToken: string | null, userId: string) {
    const auth = createOAuthClient(accessToken, refreshToken || undefined);
    this.gmail = google.gmail({ version: 'v1', auth });
    this.userId = userId;
  }

  /**
   * Get user's Gmail profile
   */
  async getProfile(): Promise<gmail_v1.Schema$Profile> {
    try {
      const response = await this.gmail.users.getProfile({ userId: 'me' });
      return response.data;
    } catch (error) {
      logger.error('Failed to get Gmail profile', {
        userId: this.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List messages with pagination
   * Uses historyId for incremental sync if provided
   */
  async listMessages(options: {
    maxResults?: number;
    pageToken?: string;
    q?: string; // Gmail search query
    historyId?: string;
  }): Promise<{
    messages: GmailMessage[];
    nextPageToken?: string;
    historyId?: string;
  }> {
    try {
      const params: gmail_v1.Params$Resource$Users$Messages$List = {
        userId: 'me',
        maxResults: options.maxResults || 100,
        pageToken: options.pageToken,
        q: options.q,
      };

      const response = await this.gmail.users.messages.list(params);
      const messages = response.data.messages || [];

      // Fetch full message details
      const messageDetails = await Promise.all(
        messages.map((msg) => this.getMessage(msg.id!))
      );

      return {
        messages: messageDetails,
        nextPageToken: response.data.nextPageToken || undefined,
        historyId: response.data.historyId || undefined,
      };
    } catch (error) {
      logger.error('Failed to list Gmail messages', {
        userId: this.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a single message by ID
   */
  async getMessage(messageId: string): Promise<GmailMessage> {
    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      return {
        id: response.data.id!,
        threadId: response.data.threadId!,
        snippet: response.data.snippet || '',
        payload: response.data.payload,
        labelIds: response.data.labelIds,
        internalDate: response.data.internalDate,
      };
    } catch (error) {
      logger.error('Failed to get Gmail message', {
        userId: this.userId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Extract metadata from Gmail message
   */
  extractMetadata(message: GmailMessage): GmailMessageMetadata {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string): string | undefined => {
      return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;
    };

    const fromHeader = getHeader('From') || '';
    const fromMatch = fromHeader.match(/^(.+?)\s*<(.+?)>$/) || [null, fromHeader, fromHeader];
    const senderName = fromMatch[1]?.trim();
    const senderEmail = fromMatch[2]?.trim() || fromHeader;

    const receivedAt = message.internalDate
      ? new Date(parseInt(message.internalDate))
      : new Date();

    return {
      messageId: message.id,
      threadId: message.threadId,
      senderEmail,
      senderName,
      subject: getHeader('Subject') || undefined,
      receivedAt,
      snippet: message.snippet.substring(0, 200), // Privacy-first: limit snippet
      labels: message.labelIds || [],
    };
  }

  /**
   * Get thread details (for thread signal feature)
   */
  async getThread(threadId: string): Promise<gmail_v1.Schema$Thread> {
    try {
      const response = await this.gmail.users.threads.get({
        userId: 'me',
        id: threadId,
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to get Gmail thread', {
        userId: this.userId,
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get history for incremental sync
   */
  async getHistory(historyId: string, maxResults?: number): Promise<{
    history: gmail_v1.Schema$History[];
    historyId?: string;
  }> {
    try {
      const response = await this.gmail.users.history.list({
        userId: 'me',
        startHistoryId: historyId,
        maxResults: maxResults || 100,
      });

      return {
        history: response.data.history || [],
        historyId: response.data.historyId || undefined,
      };
    } catch (error) {
      logger.error('Failed to get Gmail history', {
        userId: this.userId,
        historyId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

