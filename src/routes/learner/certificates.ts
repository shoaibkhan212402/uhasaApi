import { Router } from 'express';
import { query } from '../../db/pool.js';
import { authRequired, elearnerRequired } from '../../middleware/auth.js';

const router = Router();

router.get('/', authRequired, elearnerRequired, async (req, res) => {
  try {
    const certs = await query(
      `SELECT cert.id, cert.issued_at, c.title, c.hours, c.category, en.completed_at
       FROM elearning_certificates cert
       JOIN elearning_enrollments en ON en.id = cert.enrollment_id
       JOIN elearning_courses c ON c.id = en.course_id
       WHERE en.user_id = ?
       ORDER BY cert.issued_at DESC`,
      [req.user!.id]
    );
    res.json(certs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch certificates' });
  }
});

export default router;
