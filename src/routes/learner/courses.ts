import { Router } from 'express';
import { insert, query, queryOne } from '../../db/pool.js';
import { ensureCourseStructure } from '../../services/lmsService.js';
import {
  courseRequiresPayment,
  getUserUasaMember,
  withCoursePricing,
} from '../../services/elearningPricing.js';
import { authRequired, elearnerRequired } from '../../middleware/auth.js';

const router = Router();

type CourseRow = {
  id: number;
  title: string;
  category: string;
  hours: number;
  level: string;
  image_url: string | null;
  price: number;
  enrollment_type: string;
  workshop_id: number | null;
};

function mapAvailableCourses(
  courses: (CourseRow & { enrolled: number })[],
  isUasaMember: boolean
) {
  return courses.map((c) => ({
    ...withCoursePricing(c, isUasaMember),
    enrolled: c.enrolled,
  }));
}

router.get('/available', authRequired, elearnerRequired, async (req, res) => {
  try {
    const isUasaMember = await getUserUasaMember(queryOne, req.user!.id);
    const courses = await query<CourseRow & { enrolled: number }>(
      `SELECT c.id, c.title, c.category, c.hours, c.level, c.image_url, c.price, c.enrollment_type, c.workshop_id,
              CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END AS enrolled
       FROM elearning_courses c
       LEFT JOIN elearning_enrollments e ON e.course_id = c.id AND e.user_id = ?
       WHERE c.is_published = 1
       ORDER BY c.sort_order, c.id`,
      [req.user!.id]
    );
    res.json({
      is_uasa_member: isUasaMember,
      courses: mapAvailableCourses(courses, isUasaMember),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('GET /learner/courses/available failed:', err);
    res.status(500).json({ error: 'Failed to fetch courses', detail: message });
  }
});

router.get('/', authRequired, elearnerRequired, async (req, res) => {
  try {
    const enrollments = await query(
      `SELECT en.id AS enrollment_id, en.status, en.enrolled_at, en.completed_at,
              c.id, c.title, c.category, c.hours, c.level, c.image_url, c.workshop_id
       FROM elearning_enrollments en
       JOIN elearning_courses c ON c.id = en.course_id
       WHERE en.user_id = ?
       ORDER BY en.enrolled_at DESC`,
      [req.user!.id]
    );
    res.json(enrollments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

router.post('/:courseId/enroll', authRequired, elearnerRequired, async (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const userId = req.user!.id;

    const course = await queryOne<CourseRow>(
      `SELECT id, title, price, enrollment_type FROM elearning_courses WHERE id = ? AND is_published = 1`,
      [courseId]
    );
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const existing = await queryOne(
      `SELECT id FROM elearning_enrollments WHERE user_id = ? AND course_id = ?`,
      [userId, courseId]
    );
    if (existing) {
      return res.status(409).json({ error: 'Already enrolled in this course' });
    }

    const isUasaMember = await getUserUasaMember(queryOne, userId);
    if (courseRequiresPayment(course, isUasaMember)) {
      return res.status(402).json({
        error: 'This course requires payment',
        price: Number(course.price),
        list_price: Number(course.price),
        effective_price: Number(course.price),
        payment_required: true,
        is_uasa_member: isUasaMember,
      });
    }

    const enrollmentId = await insert(
      `INSERT INTO elearning_enrollments (user_id, course_id, status) VALUES (?, ?, 'active')`,
      [userId, courseId]
    );

    await ensureCourseStructure(courseId);

    res.status(201).json({
      enrollment_id: enrollmentId,
      message: isUasaMember && Number(course.price) > 0
        ? 'Enrolled successfully (UASA Member — no fee)'
        : 'Enrolled successfully',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Enrollment failed' });
  }
});

export default router;
