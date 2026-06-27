import { Router } from 'express';
import { query, queryOne } from '../../db/pool.js';
import { authRequired, elearnerRequired } from '../../middleware/auth.js';

const router = Router();

router.get('/stats', authRequired, elearnerRequired, async (req, res) => {
  try {
    const userId = req.user!.id;

    const enrolled = await queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM elearning_enrollments WHERE user_id = ?`,
      [userId]
    );

    const inProgress = await queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM elearning_enrollments WHERE user_id = ? AND status = 'active'`,
      [userId]
    );

    const completed = await queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM elearning_enrollments WHERE user_id = ? AND status = 'completed'`,
      [userId]
    );

    const certificates = await queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM elearning_certificates c
       JOIN elearning_enrollments e ON e.id = c.enrollment_id
       WHERE e.user_id = ?`,
      [userId]
    );

    res.json({
      enrolled: enrolled?.count ?? 0,
      in_progress: inProgress?.count ?? 0,
      completed: completed?.count ?? 0,
      certificates: certificates?.count ?? 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;
