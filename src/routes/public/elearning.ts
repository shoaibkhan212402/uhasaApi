import { Router } from 'express';
import { query } from '../../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const courses = await query(
      `SELECT * FROM elearning_courses WHERE is_published = 1 ORDER BY sort_order, id`
    );
    res.json(courses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.get('/:courseId', async (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    if (Number.isNaN(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }
    const courses = await query(
      `SELECT * FROM elearning_courses WHERE id = ? AND is_published = 1 LIMIT 1`,
      [courseId]
    );
    if (!courses.length) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json(courses[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

export default router;
