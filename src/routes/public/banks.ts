import { Router } from 'express';
import { query } from '../../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const banks = await query<{ id: number; name: string }>(
      `SELECT id, name FROM banks WHERE is_active = 1 ORDER BY name ASC`
    );
    res.json(banks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch banks' });
  }
});

export default router;
