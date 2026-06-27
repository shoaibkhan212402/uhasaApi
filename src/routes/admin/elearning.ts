import { Router } from 'express';
import { insert, pool, query, queryOne } from '../../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const courses = await query(`SELECT * FROM elearning_courses ORDER BY sort_order, id`);
    res.json(courses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const course = await queryOne(`SELECT * FROM elearning_courses WHERE id = ?`, [parseInt(req.params.id, 10)]);
    if (!course) return res.status(404).json({ error: 'Not found' });
    res.json(course);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const id = await insert(
      `INSERT INTO elearning_courses (title, category, hours, lessons, level, image_url, video_url, pdf_url, description, is_published, sort_order, price, enrollment_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.title, b.category || '', b.hours || 0, b.lessons || 0, b.level || 'Beginner',
        b.image_url || null, b.video_url || null, b.pdf_url || null, b.description || null,
        b.is_published !== false ? 1 : 0, b.sort_order ?? 0, b.price ?? 0, b.enrollment_type || 'paid',
      ]
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    await pool.execute(
      `UPDATE elearning_courses SET title=?, category=?, hours=?, lessons=?, level=?, image_url=?, video_url=?, pdf_url=?, description=?, is_published=?, sort_order=?, price=?, enrollment_type=? WHERE id=?`,
      [
        b.title, b.category, b.hours, b.lessons, b.level, b.image_url, b.video_url,
        b.pdf_url, b.description, b.is_published ? 1 : 0, b.sort_order, b.price ?? 0, b.enrollment_type || 'paid', id,
      ]
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.execute(`DELETE FROM elearning_courses WHERE id = ?`, [parseInt(req.params.id, 10)]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

export default router;
