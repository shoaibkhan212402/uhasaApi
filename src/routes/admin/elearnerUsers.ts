import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { insert, pool, query, queryOne } from '../../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const users = await query(
      `SELECT u.id, u.email, u.name, u.is_active, u.is_uasa_member, u.must_change_password, u.created_at, u.updated_at,
              COUNT(DISTINCT en.id) AS courses_enrolled,
              SUM(CASE WHEN en.status = 'completed' THEN 1 ELSE 0 END) AS courses_completed,
              COUNT(DISTINCT cert.id) AS certificates
       FROM users u
       LEFT JOIN elearning_enrollments en ON en.user_id = u.id
       LEFT JOIN elearning_certificates cert ON cert.enrollment_id = en.id
       WHERE u.role = 'elearner'
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch e-learner users' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const user = await queryOne(
      `SELECT id, email, name, is_active, is_uasa_member, must_change_password, created_at, updated_at
       FROM users WHERE id = ? AND role = 'elearner'`,
      [id]
    );
    if (!user) return res.status(404).json({ error: 'E-learner not found' });

    const enrollments = await query(
      `SELECT en.id AS enrollment_id, en.status, en.enrolled_at, en.completed_at,
              c.id AS course_id, c.title, c.hours, c.category
       FROM elearning_enrollments en
       JOIN elearning_courses c ON c.id = en.course_id
       WHERE en.user_id = ?
       ORDER BY en.enrolled_at DESC`,
      [id]
    );

    res.json({ user, enrollments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch e-learner profile' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { email, password, name, must_change_password, is_uasa_member } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const hash = await bcrypt.hash(password, 10);
    const id = await insert(
      `INSERT INTO users (email, password_hash, name, role, must_change_password, is_uasa_member) VALUES (?, ?, ?, 'elearner', ?, ?)`,
      [email, hash, name || '', must_change_password !== false ? 1 : 0, is_uasa_member ? 1 : 0]
    );
    res.status(201).json({ id });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create e-learner' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, is_active, password, must_change_password, is_uasa_member } = req.body;

    const existing = await queryOne(`SELECT id FROM users WHERE id = ? AND role = 'elearner'`, [id]);
    if (!existing) return res.status(404).json({ error: 'E-learner not found' });

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.execute(
        `UPDATE users SET name=?, is_active=?, must_change_password=?, is_uasa_member=?, password_hash=? WHERE id=?`,
        [name, is_active ? 1 : 0, must_change_password ? 1 : 0, is_uasa_member ? 1 : 0, hash, id]
      );
    } else {
      await pool.execute(
        `UPDATE users SET name=?, is_active=?, must_change_password=?, is_uasa_member=? WHERE id=?`,
        [name, is_active ? 1 : 0, must_change_password ? 1 : 0, is_uasa_member ? 1 : 0, id]
      );
    }
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update e-learner' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.user?.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const result = await pool.execute(`DELETE FROM users WHERE id = ? AND role = 'elearner'`, [id]);
    const affected = (result[0] as { affectedRows: number }).affectedRows;
    if (!affected) return res.status(404).json({ error: 'E-learner not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete e-learner' });
  }
});

export default router;
