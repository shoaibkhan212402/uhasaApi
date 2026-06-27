import { Router } from 'express';
import { insert, pool, query } from '../../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const pages = await query(
      `SELECT page_slug, COUNT(*) as section_count, MAX(updated_at) as updated_at
       FROM page_sections GROUP BY page_slug ORDER BY page_slug`
    );
    res.json(pages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const sections = await query(
      `SELECT * FROM page_sections WHERE page_slug = ? ORDER BY sort_order`,
      [req.params.slug]
    );
    res.json(sections);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch page sections' });
  }
});

router.put('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const sections = req.body.sections as Array<{
      section_key: string;
      title: string;
      content: string;
      sort_order?: number;
      is_published?: boolean;
    }>;

    await pool.execute(`DELETE FROM page_sections WHERE page_slug = ?`, [slug]);

    for (const s of sections) {
      await insert(
        `INSERT INTO page_sections (page_slug, section_key, title, content, sort_order, is_published)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [slug, s.section_key, s.title || '', s.content, s.sort_order ?? 0, s.is_published !== false ? 1 : 0]
      );
    }

    res.json({ message: 'Page updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update page' });
  }
});

export default router;
