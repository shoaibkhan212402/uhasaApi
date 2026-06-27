import { Router } from 'express';
import { query, queryOne } from '../../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const trainers = await query(`SELECT * FROM trainers WHERE is_published = 1 ORDER BY sort_order, id`);
    res.json(trainers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch trainers' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const trainer = await queryOne(`SELECT * FROM trainers WHERE id = ? AND is_published = 1`, [id]);
    if (!trainer) return res.status(404).json({ error: 'Trainer not found' });
    res.json(trainer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch trainer' });
  }
});

export default router;
