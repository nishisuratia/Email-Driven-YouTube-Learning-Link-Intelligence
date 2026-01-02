import { config } from '../../config';
import { FeatureExtractor, FeatureScores } from '../features/extractor';
import { query } from '../../db/connection';

export type Classification = 'watch_now' | 'save' | 'skip';

export interface RankingResult {
  linkId: string;
  videoId: string;
  finalScore: number;
  classification: Classification;
  explanation: string;
  topicTags: string[];
  featureScores: FeatureScores;
}

export interface RankingContext {
  userId: string;
  linkId: string;
  videoId: string;
  videoTitle: string;
  videoDescription?: string;
  videoPublishedAt: Date;
  senderEmail: string;
  threadId: string;
  threadReplyCount: number;
  emailReceivedAt: Date;
  userLearningGoals?: string[];
}

/**
 * Ranking Service
 * 
 * Computes final score using weighted linear combination:
 * score = 0.3 * sender_score
 *      + 0.2 * thread_score
 *      + 0.2 * freshness_score
 *      + 0.2 * topic_match_score
 *      + 0.1 * (1 - noise_penalty)
 * 
 * Classification:
 * - Watch Now: score >= 0.7
 * - Save: 0.4 <= score < 0.7
 * - Skip: score < 0.4
 */
export class Ranker {
  private featureExtractor: FeatureExtractor;

  constructor() {
    this.featureExtractor = new FeatureExtractor();
  }

  /**
   * Rank a single video link
   */
  async rank(context: RankingContext): Promise<RankingResult> {
    // Extract features
    const featureScores = await this.featureExtractor.extractFeatures({
      userId: context.userId,
      senderEmail: context.senderEmail,
      threadId: context.threadId,
      threadReplyCount: context.threadReplyCount,
      emailReceivedAt: context.emailReceivedAt,
      videoPublishedAt: context.videoPublishedAt,
      videoTitle: context.videoTitle,
      videoDescription: context.videoDescription,
      userLearningGoals: context.userLearningGoals,
    });

    // Compute final score (weighted linear combination)
    const weights = config.ranking.featureWeights;
    const finalScore =
      weights.senderScore * featureScores.senderScore +
      weights.threadScore * featureScores.threadScore +
      weights.freshnessScore * featureScores.freshnessScore +
      weights.topicMatchScore * featureScores.topicMatchScore +
      weights.noisePenalty * featureScores.noisePenalty;

    // Classify
    const classification = this.classify(finalScore);

    // Generate explanation
    const explanation = this.generateExplanation(
      finalScore,
      classification,
      featureScores,
      context
    );

    // Extract topic tags (simple keyword extraction from title)
    const topicTags = this.extractTopicTags(context.videoTitle);

    return {
      linkId: context.linkId,
      videoId: context.videoId,
      finalScore: Math.max(0, Math.min(1, finalScore)), // Clamp to [0, 1]
      classification,
      explanation,
      topicTags,
      featureScores,
    };
  }

  /**
   * Classify based on score thresholds
   */
  private classify(score: number): Classification {
    if (score >= config.ranking.watchNowThreshold) {
      return 'watch_now';
    } else if (score >= config.ranking.saveThreshold) {
      return 'save';
    } else {
      return 'skip';
    }
  }

  /**
   * Generate explanation for ranking
   */
  private generateExplanation(
    score: number,
    classification: Classification,
    features: FeatureScores,
    context: RankingContext
  ): string {
    const reasons: string[] = [];

    if (features.senderScore > 0.7) {
      reasons.push('from an important sender');
    }

    if (features.threadScore > 0.5) {
      reasons.push('part of an active thread');
    }

    if (features.freshnessScore > 0.7) {
      reasons.push('recently published');
    }

    if (features.topicMatchScore > 0.5) {
      reasons.push('matches your learning goals');
    }

    if (features.noisePenalty < 0.7) {
      reasons.push('from a frequent sender');
    }

    if (reasons.length === 0) {
      return `Ranked ${classification} (score: ${score.toFixed(2)})`;
    }

    return `Ranked ${classification} because it's ${reasons.join(', ')} (score: ${score.toFixed(2)})`;
  }

  /**
   * Extract topic tags from video title (simple keyword extraction)
   */
  private extractTopicTags(title: string): string[] {
    // Simple approach: extract capitalized words and common tech terms
    const words = title.split(/\s+/);
    const tags: string[] = [];

    // Common tech keywords
    const techKeywords = [
      'javascript',
      'typescript',
      'python',
      'react',
      'node',
      'api',
      'tutorial',
      'guide',
      'tutorial',
      'course',
    ];

    for (const word of words) {
      const normalized = word.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalized.length > 3 && techKeywords.includes(normalized)) {
        tags.push(normalized);
      }
    }

    return tags.slice(0, 5); // Limit to 5 tags
  }

  /**
   * Store ranking in database
   */
  async storeRanking(userId: string, result: RankingResult): Promise<void> {
    await query(
      `
      INSERT INTO rankings (
        user_id, link_id, video_id,
        sender_score, thread_score, freshness_score,
        topic_match_score, noise_penalty,
        final_score, classification, explanation, topic_tags,
        ranked_at, ranking_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), 1)
      ON CONFLICT (user_id, link_id, ranked_at) DO UPDATE SET
        final_score = EXCLUDED.final_score,
        classification = EXCLUDED.classification,
        explanation = EXCLUDED.explanation,
        topic_tags = EXCLUDED.topic_tags
      `,
      [
        userId,
        result.linkId,
        result.videoId,
        result.featureScores.senderScore,
        result.featureScores.threadScore,
        result.featureScores.freshnessScore,
        result.featureScores.topicMatchScore,
        result.featureScores.noisePenalty,
        result.finalScore,
        result.classification,
        result.explanation,
        result.topicTags,
      ]
    );
  }
}

