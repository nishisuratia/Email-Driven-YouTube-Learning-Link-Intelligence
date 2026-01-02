import { Ranker } from '../services/ranking/ranker';
import { query } from '../db/connection';
import { RankingComputeJobData } from '../queue';
import { logger } from '../utils/logger';

/**
 * Ranking Worker
 * 
 * Computes rankings for user's YouTube links:
 * 1. Fetch recent links with video metadata
 * 2. Extract features
 * 3. Compute rankings
 * 4. Store rankings
 */
export async function computeRankingJob(jobData: RankingComputeJobData): Promise<void> {
  const { userId, dateRange } = jobData;
  const jobLogger = logger.child({ jobId: `ranking-${userId}`, userId });

  try {
    const ranker = new Ranker();

    // Get user preferences (learning goals)
    const user = await query<{ preferences: any; email: string }>(
      `SELECT preferences, email FROM users WHERE id = $1`,
      [userId]
    );

    if (user.length === 0) {
      throw new Error(`User not found: ${userId}`);
    }

    const learningGoals = user[0].preferences?.learning_goals || [];

    // Calculate date range
    const startDate = dateRange?.start ? new Date(dateRange.start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.end ? new Date(dateRange.end) : new Date();

    // Fetch links with video metadata that haven't been ranked recently
    const links = await query(
      `
      SELECT
        yl.id as link_id,
        yl.video_id,
        yl.user_id,
        vm.title,
        vm.description_keywords,
        vm.published_at,
        e.sender_email,
        e.thread_id,
        e.thread_reply_count,
        e.received_at
      FROM youtube_links yl
      JOIN video_metadata vm ON yl.video_id = vm.video_id
      JOIN emails e ON yl.email_id = e.id
      WHERE yl.user_id = $1
        AND yl.extracted_at >= $2
        AND yl.extracted_at < $3
        AND NOT EXISTS (
          SELECT 1 FROM rankings r
          WHERE r.link_id = yl.id
            AND r.ranked_at >= NOW() - INTERVAL '1 day'
        )
      ORDER BY yl.extracted_at DESC
      `,
      [userId, startDate, endDate]
    );

    jobLogger.info('Computing rankings', { linkCount: links.length });

    // Rank each link
    let rankedCount = 0;
    for (const link of links) {
      try {
        const result = await ranker.rank({
          userId: link.user_id,
          linkId: link.link_id,
          videoId: link.video_id,
          videoTitle: link.title,
          videoDescription: link.description_keywords?.join(' '),
          videoPublishedAt: new Date(link.published_at),
          senderEmail: link.sender_email,
          threadId: link.thread_id,
          threadReplyCount: link.thread_reply_count || 0,
          emailReceivedAt: new Date(link.received_at),
          userLearningGoals: learningGoals,
        });

        await ranker.storeRanking(userId, result);
        rankedCount++;
      } catch (error) {
        jobLogger.warn('Failed to rank link', {
          linkId: link.link_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    jobLogger.info('Ranking completed', { rankedCount, totalLinks: links.length });
  } catch (error) {
    jobLogger.error('Failed to compute rankings', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

