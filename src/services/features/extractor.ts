import { query } from '../../db/connection';
import { config } from '../../config';

export interface FeatureScores {
  senderScore: number;
  threadScore: number;
  freshnessScore: number;
  topicMatchScore: number;
  noisePenalty: number;
}

export interface FeatureExtractionContext {
  userId: string;
  senderEmail: string;
  threadId: string;
  threadReplyCount: number;
  emailReceivedAt: Date;
  videoPublishedAt: Date;
  videoTitle: string;
  videoDescription?: string;
  userLearningGoals?: string[];
}

/**
 * Feature Extraction Service
 * 
 * Extracts features for ranking:
 * - SenderScore: Importance based on frequency, recency, contacts
 * - ThreadSignal: Boost if thread has activity
 * - Freshness: Time decay based on publish date
 * - TopicMatch: Keyword matching against learning goals
 * - NoisePenalty: Penalize bulk senders
 */
export class FeatureExtractor {
  /**
   * Extract all features for a video link
   */
  async extractFeatures(context: FeatureExtractionContext): Promise<FeatureScores> {
    const [senderScore, threadScore, freshnessScore, topicMatchScore, noisePenalty] =
      await Promise.all([
        this.computeSenderScore(context.userId, context.senderEmail),
        this.computeThreadScore(context.threadReplyCount),
        this.computeFreshnessScore(context.videoPublishedAt, context.emailReceivedAt),
        this.computeTopicMatchScore(
          context.videoTitle,
          context.videoDescription,
          context.userLearningGoals || []
        ),
        this.computeNoisePenalty(context.userId, context.senderEmail),
      ]);

    return {
      senderScore,
      threadScore,
      freshnessScore,
      topicMatchScore,
      noisePenalty,
    };
  }

  /**
   * SenderScore: log(email_count + 1) * recency_decay * contacts_boost
   */
  private async computeSenderScore(
    userId: string,
    senderEmail: string
  ): Promise<number> {
    const stats = await query<{
      email_count: number;
      last_email_at: Date;
      is_in_contacts: boolean;
    }>(
      `
      SELECT email_count, last_email_at, is_in_contacts
      FROM sender_stats
      WHERE user_id = $1 AND sender_email = $2
      `,
      [userId, senderEmail]
    );

    if (stats.length === 0) {
      return 0.1; // Default score for unknown senders
    }

    const stat = stats[0];
    const emailCount = stat.email_count || 0;

    // Log scale: log(email_count + 1) / log(max_count + 1)
    // Assuming max_count = 1000 for normalization
    const logScore = Math.log(emailCount + 1) / Math.log(1001);
    const normalizedLogScore = Math.min(logScore, 1.0);

    // Recency decay: more recent = higher score
    const daysSinceLastEmail = stat.last_email_at
      ? (Date.now() - new Date(stat.last_email_at).getTime()) / (1000 * 60 * 60 * 24)
      : 365;
    const recencyDecay = Math.exp(-daysSinceLastEmail / 30); // Half-life: 30 days

    // Contacts boost: 1.5x if in contacts
    const contactsBoost = stat.is_in_contacts ? 1.5 : 1.0;

    return Math.min(normalizedLogScore * recencyDecay * contactsBoost, 1.0);
  }

  /**
   * ThreadScore: min(thread_reply_count / 3, 1.0)
   */
  private computeThreadScore(threadReplyCount: number): number {
    return Math.min(threadReplyCount / 3, 1.0);
  }

  /**
   * FreshnessScore: exp(-days_since_publish / half_life)
   */
  private computeFreshnessScore(
    videoPublishedAt: Date,
    emailReceivedAt: Date
  ): number {
    const daysSincePublish =
      (emailReceivedAt.getTime() - videoPublishedAt.getTime()) / (1000 * 60 * 60 * 24);
    const halfLifeDays = config.ranking.freshnessHalfLifeDays;
    return Math.exp(-daysSincePublish / halfLifeDays);
  }

  /**
   * TopicMatchScore: keyword_matches / total_keywords
   */
  private computeTopicMatchScore(
    videoTitle: string,
    videoDescription: string | undefined,
    learningGoals: string[]
  ): number {
    if (learningGoals.length === 0) {
      return 0.5; // Neutral score if no learning goals
    }

    const text = `${videoTitle} ${videoDescription || ''}`.toLowerCase();
    const matches = learningGoals.filter((goal) =>
      text.includes(goal.toLowerCase())
    );

    return matches.length / learningGoals.length;
  }

  /**
   * NoisePenalty: 1.0 - min(sender_email_count / 100, 0.5)
   */
  private async computeNoisePenalty(
    userId: string,
    senderEmail: string
  ): Promise<number> {
    const stats = await query<{ email_count: number }>(
      `
      SELECT email_count
      FROM sender_stats
      WHERE user_id = $1 AND sender_email = $2
      `,
      [userId, senderEmail]
    );

    if (stats.length === 0) {
      return 1.0; // No penalty for unknown senders
    }

    const emailCount = stats[0].email_count || 0;
    const penalty = Math.min(emailCount / 100, 0.5);
    return 1.0 - penalty;
  }
}

