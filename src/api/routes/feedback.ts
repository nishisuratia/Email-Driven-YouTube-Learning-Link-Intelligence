import { Router, Request, Response } from 'express';
import { query } from '../../db/connection';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * POST /api/feedback
 * Submit user feedback
 * Body: { linkId, action: 'watched'|'saved'|'skipped', label?: 'watch_now'|'save'|'skip' }
 */
router.post('/', async (req: Request, res: Response) => {
  const userId = req.body.userId as string; // In production, get from auth middleware
  const { linkId, action, label } = req.body;

  if (!userId || !linkId || !action) {
    return res.status(400).json({ error: 'userId, linkId, and action are required' });
  }

  const validActions = ['watched', 'saved', 'skipped', 'dismissed'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
  }

  if (label) {
    const validLabels = ['watch_now', 'save', 'skip'];
    if (!validLabels.includes(label)) {
      return res.status(400).json({ error: `label must be one of: ${validLabels.join(', ')}` });
    }
  }

  try {
    // Get most recent ranking for this link
    const ranking = await query<{ id: string }>(
      `
      SELECT id FROM rankings
      WHERE user_id = $1 AND link_id = $2
      ORDER BY ranked_at DESC
      LIMIT 1
      `,
      [userId, linkId]
    );

    const rankingId = ranking.length > 0 ? ranking[0].id : null;

    // Store feedback
    await query(
      `
      INSERT INTO feedback (
        user_id, link_id, ranking_id,
        action, label, user_agent, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        userId,
        linkId,
        rankingId,
        action,
        label || null,
        req.get('user-agent') || null,
        req.ip || null,
      ]
    );

    logger.info('Feedback submitted', { userId, linkId, action, label });

    res.json({ success: true, message: 'Feedback recorded' });
  } catch (error) {
    logger.error('Failed to submit feedback', {
      userId,
      linkId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

export default router;

