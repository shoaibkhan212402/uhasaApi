import { Router } from 'express';
import { query } from '../../db/pool.js';

const router = Router();

router.get('/settings', async (_req, res) => {
  try {
    const rows = await query<{ setting_key: string; setting_value: string }>(
      `SELECT setting_key, setting_value FROM site_settings`
    );
    const settings = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const sections = await query(
      `SELECT section_key, title, content, sort_order FROM page_sections
       WHERE page_slug = ? AND is_published = 1 ORDER BY sort_order`,
      [req.params.slug]
    );
    res.json(sections);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch page content' });
  }
});

export default router;
