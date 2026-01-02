import { YouTubeClient } from '../services/youtube/client';
import { query } from '../db/connection';
import { VideoEnrichJobData } from '../queue';
import { logger } from '../utils/logger';
import { redisConnection } from '../queue';
import { config } from '../config';

/**
 * Video Enrichment Worker
 * 
 * Fetches YouTube metadata for video links:
 * 1. Get video ID from link
 * 2. Check cache (Redis)
 * 3. Fetch from YouTube API if not cached
 * 4. Store in database and cache
 */
export async function enrichVideoJob(jobData: VideoEnrichJobData): Promise<void> {
  const { userId, linkId, videoId } = jobData;
  const jobLogger = logger.child({ jobId: `enrich-${videoId}`, userId });

  try {
    // Check if metadata already exists in DB
    const existing = await query<{ video_id: string }>(
      `SELECT video_id FROM video_metadata WHERE video_id = $1`,
      [videoId]
    );

    if (existing.length > 0) {
      jobLogger.info('Video metadata already exists, skipping', { videoId });
      return;
    }

    // Create YouTube client
    const youtubeClient = new YouTubeClient(config.youtube.apiKey, redisConnection);

    // Fetch metadata (with caching handled by client)
    const metadataMap = await youtubeClient.getVideoMetadata([videoId]);
    const metadata = metadataMap.get(videoId);

    if (!metadata) {
      jobLogger.warn('Video metadata not found', { videoId });
      return;
    }

    // Store in database
    await query(
      `
      INSERT INTO video_metadata (
        video_id, title, channel_id, channel_title,
        published_at, duration_seconds, category_id,
        description_keywords, thumbnail_url,
        view_count, like_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (video_id) DO UPDATE SET
        title = EXCLUDED.title,
        channel_title = EXCLUDED.channel_title,
        updated_at = NOW()
      `,
      [
        metadata.videoId,
        metadata.title,
        metadata.channelId,
        metadata.channelTitle,
        metadata.publishedAt,
        metadata.durationSeconds || null,
        metadata.categoryId || null,
        metadata.descriptionKeywords || [],
        metadata.thumbnailUrl || null,
        metadata.viewCount || null,
        metadata.likeCount || null,
      ]
    );

    jobLogger.info('Video metadata enriched successfully', { videoId });
  } catch (error) {
    jobLogger.error('Failed to enrich video', {
      videoId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

