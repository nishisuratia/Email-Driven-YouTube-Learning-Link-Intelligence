import { youtube_v3, google } from 'googleapis';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { Redis } from 'ioredis';

export interface VideoMetadata {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: Date;
  durationSeconds?: number;
  categoryId?: number;
  categoryName?: string;
  descriptionKeywords?: string[];
  thumbnailUrl?: string;
  viewCount?: number;
  likeCount?: number;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  lastFailure?: Date;
}

export class YouTubeClient {
  private youtube: youtube_v3.Youtube;
  private redis: Redis;
  private circuitBreakerState: CircuitBreakerState = {
    state: 'closed',
    failures: 0,
  };

  constructor(apiKey: string, redis: Redis) {
    // YouTube Data API v3 uses API key directly
    this.youtube = google.youtube({
      version: 'v3',
      auth: apiKey,
    });
    this.redis = redis;
  }

  /**
   * Get video metadata with caching and rate limiting
   */
  async getVideoMetadata(videoIds: string[]): Promise<Map<string, VideoMetadata>> {
    if (videoIds.length === 0) {
      return new Map();
    }

    // Check circuit breaker
    if (this.circuitBreakerState.state === 'open') {
      const timeSinceLastFailure = Date.now() - (this.circuitBreakerState.lastFailure?.getTime() || 0);
      if (timeSinceLastFailure < config.circuitBreaker.resetTimeout) {
        throw new Error('Circuit breaker is open');
      }
      // Transition to half-open
      this.circuitBreakerState.state = 'half_open';
    }

    const results = new Map<string, VideoMetadata>();
    const uncachedIds: string[] = [];

    // Check cache first
    for (const videoId of videoIds) {
      const cached = await this.getCachedMetadata(videoId);
      if (cached) {
        results.set(videoId, cached);
      } else {
        uncachedIds.push(videoId);
      }
    }

    // Fetch uncached videos in batches
    if (uncachedIds.length > 0) {
      const batchSize = config.youtube.batchSize;
      for (let i = 0; i < uncachedIds.length; i += batchSize) {
        const batch = uncachedIds.slice(i, i + batchSize);
        try {
          const batchResults = await this.fetchVideoMetadataBatch(batch);
          for (const [videoId, metadata] of batchResults) {
            results.set(videoId, metadata);
            await this.cacheMetadata(videoId, metadata);
          }
          // Reset circuit breaker on success
          this.circuitBreakerState = {
            state: 'closed',
            failures: 0,
          };
        } catch (error) {
          this.handleCircuitBreakerFailure();
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * Fetch video metadata from YouTube API (batch)
   */
  private async fetchVideoMetadataBatch(
    videoIds: string[]
  ): Promise<Map<string, VideoMetadata>> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.youtube.videos.list({
          part: ['snippet', 'contentDetails', 'statistics'],
          id: videoIds,
          maxResults: videoIds.length,
        });

        const metadataMap = new Map<string, VideoMetadata>();

        if (response.data.items) {
          for (const item of response.data.items) {
            if (!item.id || !item.snippet) continue;

            const publishedAt = item.snippet.publishedAt
              ? new Date(item.snippet.publishedAt)
              : new Date();

            // Parse duration (ISO 8601 format: PT1H2M10S)
            let durationSeconds: number | undefined;
            if (item.contentDetails?.duration) {
              durationSeconds = this.parseDuration(item.contentDetails.duration);
            }

            // Extract keywords from description (first 20 words)
            const descriptionKeywords = item.snippet.description
              ? item.snippet.description
                  .split(/\s+/)
                  .slice(0, 20)
                  .filter((w) => w.length > 3)
              : [];

            const metadata: VideoMetadata = {
              videoId: item.id,
              title: item.snippet.title || '',
              channelId: item.snippet.channelId || '',
              channelTitle: item.snippet.channelTitle || '',
              publishedAt,
              durationSeconds,
              categoryId: item.snippet.categoryId
                ? parseInt(item.snippet.categoryId, 10)
                : undefined,
              thumbnailUrl: item.snippet.thumbnails?.high?.url,
              viewCount: item.statistics?.viewCount
                ? parseInt(item.statistics.viewCount, 10)
                : undefined,
              likeCount: item.statistics?.likeCount
                ? parseInt(item.statistics.likeCount, 10)
                : undefined,
              descriptionKeywords,
            };

            metadataMap.set(item.id, metadata);
          }
        }

        return metadataMap;
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a rate limit error (429)
        if (error.code === 429 || error.response?.status === 429) {
          const retryAfter = error.response?.headers['retry-after'] || Math.pow(2, attempt);
          logger.warn('YouTube API rate limit hit', {
            attempt: attempt + 1,
            retryAfter,
          });
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // Check if it's a quota exceeded error
        if (error.message?.includes('quota') || error.response?.status === 403) {
          logger.error('YouTube API quota exceeded', { error: error.message });
          throw new Error('YouTube API quota exceeded');
        }

        // For other errors, retry with exponential backoff
        const backoff = Math.pow(2, attempt) * 1000;
        logger.warn('YouTube API error, retrying', {
          attempt: attempt + 1,
          error: error.message,
          backoff,
        });
        await this.sleep(backoff);
      }
    }

    throw lastError || new Error('Failed to fetch video metadata');
  }

  /**
   * Parse ISO 8601 duration to seconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Get cached metadata from Redis
   */
  private async getCachedMetadata(videoId: string): Promise<VideoMetadata | null> {
    try {
      const cached = await this.redis.get(`video:metadata:${videoId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Convert publishedAt back to Date
        parsed.publishedAt = new Date(parsed.publishedAt);
        return parsed;
      }
    } catch (error) {
      logger.warn('Failed to get cached metadata', {
        videoId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }

  /**
   * Cache metadata in Redis (TTL: 7 days)
   */
  private async cacheMetadata(videoId: string, metadata: VideoMetadata): Promise<void> {
    try {
      const ttl = 7 * 24 * 60 * 60; // 7 days
      await this.redis.setex(
        `video:metadata:${videoId}`,
        ttl,
        JSON.stringify(metadata)
      );
    } catch (error) {
      logger.warn('Failed to cache metadata', {
        videoId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle circuit breaker failure
   */
  private handleCircuitBreakerFailure(): void {
    this.circuitBreakerState.failures++;
    this.circuitBreakerState.lastFailure = new Date();

    if (this.circuitBreakerState.failures >= config.circuitBreaker.failureThreshold) {
      this.circuitBreakerState.state = 'open';
      logger.error('Circuit breaker opened', {
        failures: this.circuitBreakerState.failures,
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

