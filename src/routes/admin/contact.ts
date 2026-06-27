import { Router } from 'express';
import { pool, query } from '../../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { is_read } = req.query;
    let sql = `SELECT * FROM contact_messages WHERE 1=1`;
    const params: unknown[] = [];

    if (is_read !== undefined) {
      sql += ` AND is_read = ?`;
      params.push(is_read === 'true' ? 1 : 0);
    }

    sql += ` ORDER BY created_at DESC`;
    const messages = await query(sql, params);
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    await pool.execute(`UPDATE contact_messages SET is_read = 1 WHERE id = ?`, [
      parseInt(req.params.id, 10),
    ]);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.execute(`DELETE FROM contact_messages WHERE id = ?`, [parseInt(req.params.id, 10)]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

export default router;
