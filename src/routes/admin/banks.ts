import { Router } from 'express';
import { insert, pool, query, queryOne } from '../../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    let sql = `SELECT * FROM banks`;
    const params: unknown[] = [];
    if (req.user?.role === 'coordinator') {
      sql += ` WHERE created_by = ?`;
      params.push(req.user.id);
    }
    sql += ` ORDER BY name ASC`;
    const banks = await query(sql, params);
    res.json(banks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch banks' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, auto_invoice } = req.body;
    if (!name) return res.status(400).json({ error: 'Bank name is required' });
    const id = await insert(
      `INSERT INTO banks (name, auto_invoice, created_by) VALUES (?, ?, ?)`,
      [name, auto_invoice !== false ? 1 : 0, req.user?.role === 'coordinator' ? req.user.id : null]
    );
    res.status(201).json({ id });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Bank already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create bank' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, auto_invoice, is_active } = req.body;

    if (req.user?.role === 'coordinator') {
      const existing = await queryOne<{ created_by: number | null }>(
        `SELECT created_by FROM banks WHERE id = ?`,
        [id]
      );
      if (!existing) return res.status(404).json({ error: 'Bank not found' });
      if (existing.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Access denied: you did not create this bank' });
      }
    }

    await pool.execute(
      `UPDATE banks SET name=?, auto_invoice=?, is_active=? WHERE id=?`,
      [name, auto_invoice !== false ? 1 : 0, is_active !== false ? 1 : 0, id]
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update bank' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (req.user?.role === 'coordinator') {
      const existing = await queryOne<{ created_by: number | null }>(
        `SELECT created_by FROM banks WHERE id = ?`,
        [id]
      );
      if (!existing) return res.status(404).json({ error: 'Bank not found' });
      if (existing.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Access denied: you did not create this bank' });
      }
    }

    await pool.execute(`DELETE FROM banks WHERE id = ?`, [id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete bank' });
  }
});

export default router;
