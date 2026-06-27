import { Router } from 'express';
import { query } from '../../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const banners = await query(
      `SELECT id, image_url, title, subtitle, alt_text, link_url, sort_order
       FROM slider_banners
       WHERE is_published = 1
       ORDER BY sort_order, id`
    );
    res.json(banners);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

export default router;
