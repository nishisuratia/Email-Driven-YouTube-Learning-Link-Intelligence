import { Router, Request, Response } from 'express';
import { query } from '../../db/connection';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * GET /api/feed
 * Get ranked links for user
 * Query params:
 * - range: 7d, 30d, all (default: 7d)
 * - classification: watch_now, save, skip (optional filter)
 * - limit: number (default: 50)
 * - offset: number (default: 0)
 */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.query.userId as string; // In production, get from auth middleware
  const range = req.query.range as string || '7d';
  const classification = req.query.classification as string | undefined;
  const limit = parseInt(req.query.limit as string || '50', 10);
  const offset = parseInt(req.query.offset as string || '0', 10);

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  try {
    // Calculate date range
    const now = new Date();
    let startDate: Date;
    if (range === '7d') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === '30d') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(0); // All time
    }

    // Build query
    let sql = `
      SELECT
        r.id as ranking_id,
        r.final_score,
        r.classification,
        r.explanation,
        r.topic_tags,
        r.ranked_at,
        yl.id as link_id,
        yl.canonical_url,
        vm.video_id,
        vm.title,
        vm.channel_title,
        vm.thumbnail_url,
        vm.duration_seconds,
        vm.published_at,
        e.sender_email,
        e.sender_name,
        e.subject,
        e.received_at
      FROM rankings r
      JOIN youtube_links yl ON r.link_id = yl.id
      JOIN video_metadata vm ON r.video_id = vm.video_id
      JOIN emails e ON yl.email_id = e.id
      WHERE r.user_id = $1
        AND r.ranked_at >= $2
    `;

    const params: any[] = [userId, startDate];

    if (classification) {
      sql += ` AND r.classification = $${params.length + 1}`;
      params.push(classification);
    }

    sql += ` ORDER BY r.final_score DESC, r.ranked_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const results = await query(sql, params);

    res.json({
      results,
      pagination: {
        limit,
        offset,
        total: results.length, // In production, get actual total count
      },
    });
  } catch (error) {
    logger.error('Failed to fetch feed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

/**
 * GET /api/topics
 * Get topic distribution
 */
router.get('/topics', async (req: Request, res: Response) => {
  const userId = req.query.userId as string;

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  try {
    const results = await query(
      `
      SELECT
        UNNEST(topic_tags) as topic,
        COUNT(*) as count
      FROM rankings
      WHERE user_id = $1
        AND ranked_at >= NOW() - INTERVAL '30 days'
        AND topic_tags IS NOT NULL
        AND array_length(topic_tags, 1) > 0
      GROUP BY topic
      ORDER BY count DESC
      LIMIT 20
      `,
      [userId]
    );

    res.json({ topics: results });
  } catch (error) {
    logger.error('Failed to fetch topics', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

/**
 * GET /api/senders
 * Get sender statistics
 */
router.get('/senders', async (req: Request, res: Response) => {
  const userId = req.query.userId as string;

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  try {
    const results = await query(
      `
      SELECT
        sender_email,
        sender_name,
        email_count,
        last_email_at,
        is_in_contacts
      FROM sender_stats
      WHERE user_id = $1
      ORDER BY email_count DESC
      LIMIT 50
      `,
      [userId]
    );

    res.json({ senders: results });
  } catch (error) {
    logger.error('Failed to fetch senders', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to fetch senders' });
  }
});

export default router;

