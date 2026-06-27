import { Router } from 'express';
import { insert, pool, query, queryOne } from '../../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const trainers = await query(`SELECT * FROM trainers ORDER BY sort_order, id`);
    res.json(trainers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch trainers' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const trainer = await queryOne(`SELECT * FROM trainers WHERE id = ?`, [parseInt(req.params.id, 10)]);
    if (!trainer) return res.status(404).json({ error: 'Not found' });
    res.json(trainer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch trainer' });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const id = await insert(
      `INSERT INTO trainers (name, title, image_url, bio, expertise, email, linkedin_url, is_published, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.name, b.title || '', b.image_url || null, b.bio || null,
        b.expertise ? JSON.stringify(b.expertise) : null,
        b.email || null, b.linkedin_url || null, b.is_published !== false ? 1 : 0,
        b.sort_order ?? 0,
      ]
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create trainer' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    await pool.execute(
      `UPDATE trainers SET name=?, title=?, image_url=?, bio=?, expertise=?, email=?, linkedin_url=?, is_published=?, sort_order=? WHERE id=?`,
      [
        b.name, b.title, b.image_url, b.bio,
        b.expertise ? JSON.stringify(b.expertise) : null,
        b.email, b.linkedin_url, b.is_published ? 1 : 0, b.sort_order ?? 0, id,
      ]
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update trainer' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.execute(`DELETE FROM trainers WHERE id = ?`, [parseInt(req.params.id, 10)]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete trainer' });
  }
});

export default router;
