import { Router } from 'express';
import { insert, pool, query, queryOne } from '../../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const banners = await query(`SELECT * FROM slider_banners ORDER BY sort_order, id`);
    res.json(banners);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const banner = await queryOne(`SELECT * FROM slider_banners WHERE id = ?`, [parseInt(req.params.id, 10)]);
    if (!banner) return res.status(404).json({ error: 'Not found' });
    res.json(banner);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch banner' });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.image_url) {
      return res.status(400).json({ error: 'Banner image is required' });
    }
    const id = await insert(
      `INSERT INTO slider_banners (image_url, title, subtitle, alt_text, link_url, sort_order, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        b.image_url,
        b.title || '',
        b.subtitle || '',
        b.alt_text || '',
        b.link_url || null,
        b.sort_order ?? 0,
        b.is_published !== false ? 1 : 0,
      ]
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create banner' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    if (!b.image_url) {
      return res.status(400).json({ error: 'Banner image is required' });
    }
    await pool.execute(
      `UPDATE slider_banners SET image_url=?, title=?, subtitle=?, alt_text=?, link_url=?, sort_order=?, is_published=? WHERE id=?`,
      [
        b.image_url,
        b.title || '',
        b.subtitle || '',
        b.alt_text || '',
        b.link_url || null,
        b.sort_order ?? 0,
        b.is_published ? 1 : 0,
        id,
      ]
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update banner' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.execute(`DELETE FROM slider_banners WHERE id = ?`, [parseInt(req.params.id, 10)]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete banner' });
  }
});

export default router;
