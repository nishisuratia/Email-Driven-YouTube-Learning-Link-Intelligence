import { query } from '../db/connection';
import { logger } from '../utils/logger';

export interface EvaluationMetrics {
  precisionAt5: number;
  precisionAt10: number;
  precisionAt20: number;
  coverage: number;
  novelty: number;
  stability: number;
}

export interface EvaluationOptions {
  userId: string;
  dateRange: {
    start: Date;
    end: Date;
  };
  kValues?: number[]; // Default: [5, 10, 20]
}

/**
 * Evaluation Harness
 * 
 * Computes offline evaluation metrics:
 * - Precision@k: Fraction of top-k ranked items that are relevant
 * - Coverage: Fraction of links that were ranked
 * - Novelty: Fraction of unique channels
 * - Stability: Ranking consistency over time
 */
export class EvaluationHarness {
  /**
   * Run evaluation
   */
  async evaluate(options: EvaluationOptions): Promise<EvaluationMetrics> {
    const { userId, dateRange, kValues = [5, 10, 20] } = options;
    const evalLogger = logger.child({ userId });

    evalLogger.info('Starting evaluation', { dateRange });

    // Get rankings and feedback
    const rankings = await query(
      `
      SELECT
        r.id,
        r.link_id,
        r.video_id,
        r.final_score,
        r.classification,
        r.ranked_at,
        vm.channel_id,
        vm.channel_title
      FROM rankings r
      JOIN video_metadata vm ON r.video_id = vm.video_id
      WHERE r.user_id = $1
        AND r.ranked_at >= $2
        AND r.ranked_at < $3
      ORDER BY r.ranked_at DESC, r.final_score DESC
      `,
      [userId, dateRange.start, dateRange.end]
    );

    const feedback = await query<{
      link_id: string;
      action: string;
      label: string | null;
    }>(
      `
      SELECT link_id, action, label
      FROM feedback
      WHERE user_id = $1
        AND provided_at >= $2
        AND provided_at < $3
      `,
      [userId, dateRange.start, dateRange.end]
    );

    // Build relevance map (from feedback labels or actions)
    const relevanceMap = new Map<string, boolean>();
    for (const fb of feedback) {
      // Consider 'watched' or label='watch_now' as relevant
      const isRelevant =
        fb.action === 'watched' || fb.label === 'watch_now';
      relevanceMap.set(fb.link_id, isRelevant);
    }

    // Compute metrics
    const precisionAt5 = this.computePrecisionAtK(rankings, relevanceMap, 5);
    const precisionAt10 = this.computePrecisionAtK(rankings, relevanceMap, 10);
    const precisionAt20 = this.computePrecisionAtK(rankings, relevanceMap, 20);

    const coverage = this.computeCoverage(userId, dateRange);
    const novelty = this.computeNovelty(rankings);
    const stability = await this.computeStability(userId, dateRange);

    const metrics: EvaluationMetrics = {
      precisionAt5,
      precisionAt10,
      precisionAt20,
      coverage,
      novelty,
      stability,
    };

    evalLogger.info('Evaluation completed', metrics);
    return metrics;
  }

  /**
   * Compute Precision@k
   */
  private computePrecisionAtK(
    rankings: any[],
    relevanceMap: Map<string, boolean>,
    k: number
  ): number {
    const topK = rankings.slice(0, k);
    if (topK.length === 0) return 0;

    let relevantCount = 0;
    for (const ranking of topK) {
      const isRelevant = relevanceMap.get(ranking.link_id);
      if (isRelevant === true) {
        relevantCount++;
      }
    }

    return relevantCount / topK.length;
  }

  /**
   * Compute Coverage: fraction of links that were ranked
   */
  private async computeCoverage(
    userId: string,
    dateRange: { start: Date; end: Date }
  ): Promise<number> {
    const [totalLinks, rankedLinks] = await Promise.all([
      query<{ count: number }>(
        `
        SELECT COUNT(*) as count
        FROM youtube_links
        WHERE user_id = $1
          AND extracted_at >= $2
          AND extracted_at < $3
        `,
        [userId, dateRange.start, dateRange.end]
      ),
      query<{ count: number }>(
        `
        SELECT COUNT(DISTINCT link_id) as count
        FROM rankings
        WHERE user_id = $1
          AND ranked_at >= $2
          AND ranked_at < $3
        `,
        [userId, dateRange.start, dateRange.end]
      ),
    ]);

    const total = totalLinks[0]?.count || 0;
    const ranked = rankedLinks[0]?.count || 0;

    return total > 0 ? ranked / total : 0;
  }

  /**
   * Compute Novelty: fraction of unique channels
   */
  private computeNovelty(rankings: any[]): number {
    if (rankings.length === 0) return 0;

    const uniqueChannels = new Set(
      rankings.map((r) => r.channel_id).filter(Boolean)
    );

    return uniqueChannels.size / rankings.length;
  }

  /**
   * Compute Stability: ranking consistency over time
   */
  private async computeStability(
    userId: string,
    dateRange: { start: Date; end: Date }
  ): Promise<number> {
    // Get rankings grouped by day
    const dailyRankings = await query(
      `
      SELECT
        DATE(ranked_at) as date,
        link_id,
        final_score,
        ROW_NUMBER() OVER (PARTITION BY DATE(ranked_at) ORDER BY final_score DESC) as rank
      FROM rankings
      WHERE user_id = $1
        AND ranked_at >= $2
        AND ranked_at < $3
      ORDER BY date, final_score DESC
      `,
      [userId, dateRange.start, dateRange.end]
    );

    if (dailyRankings.length < 2) return 1.0; // Perfect stability if < 2 rankings

    // Compute rank correlation between consecutive days
    const dates = Array.from(new Set(dailyRankings.map((r: any) => r.date))).sort();
    let totalCorrelation = 0;
    let pairCount = 0;

    for (let i = 0; i < dates.length - 1; i++) {
      const day1 = dates[i];
      const day2 = dates[i + 1];

      const ranks1 = dailyRankings
        .filter((r: any) => r.date === day1)
        .slice(0, 20) // Top 20 for stability
        .map((r: any) => r.link_id);
      const ranks2 = dailyRankings
        .filter((r: any) => r.date === day2)
        .slice(0, 20)
        .map((r: any) => r.link_id);

      // Compute overlap (Jaccard similarity)
      const set1 = new Set(ranks1);
      const set2 = new Set(ranks2);
      const intersection = new Set([...set1].filter((x) => set2.has(x)));
      const union = new Set([...set1, ...set2]);

      const similarity = union.size > 0 ? intersection.size / union.size : 0;
      totalCorrelation += similarity;
      pairCount++;
    }

    return pairCount > 0 ? totalCorrelation / pairCount : 1.0;
  }

  /**
   * Generate evaluation report
   */
  async generateReport(
    options: EvaluationOptions
  ): Promise<{ metrics: EvaluationMetrics; report: string }> {
    const metrics = await this.evaluate(options);

    const report = `
# Evaluation Report

## Metrics

- **Precision@5**: ${metrics.precisionAt5.toFixed(3)}
- **Precision@10**: ${metrics.precisionAt10.toFixed(3)}
- **Precision@20**: ${metrics.precisionAt20.toFixed(3)}
- **Coverage**: ${metrics.coverage.toFixed(3)} (fraction of links ranked)
- **Novelty**: ${metrics.novelty.toFixed(3)} (fraction of unique channels)
- **Stability**: ${metrics.stability.toFixed(3)} (ranking consistency)

## Interpretation

- **Precision@k**: Higher is better. Measures relevance of top-k recommendations.
- **Coverage**: Higher is better. Measures system's ability to rank all links.
- **Novelty**: Higher is better. Measures diversity of recommended channels.
- **Stability**: Higher is better. Measures consistency of rankings over time.

## Date Range

- Start: ${options.dateRange.start.toISOString()}
- End: ${options.dateRange.end.toISOString()}
    `;

    return { metrics, report };
  }
}

