import { Router } from 'express';
import { insert, pool, query, queryOne } from '../../db/pool.js';
import {
  buildPlayerPayload,
  getEnrollmentForUser,
  getQuizQuestions,
  sanitizeQuestionForClient,
  saveVideoProgress,
  submitQuizAttempt,
} from '../../services/lmsService.js';
import { authRequired, elearnerRequired } from '../../middleware/auth.js';

const router = Router();

router.get('/:courseId', authRequired, elearnerRequired, async (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const enrollment = await getEnrollmentForUser(req.user!.id, courseId);
    if (!enrollment) return res.status(403).json({ error: 'Not enrolled in this course' });

    const payload = await buildPlayerPayload(enrollment.id, courseId, req.user!.id);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load player' });
  }
});

router.post('/:courseId/progress', authRequired, elearnerRequired, async (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const { chapter_id, watched_seconds, last_position_seconds } = req.body;
    if (!chapter_id) return res.status(400).json({ error: 'chapter_id required' });

    const enrollment = await getEnrollmentForUser(req.user!.id, courseId);
    if (!enrollment) return res.status(403).json({ error: 'Not enrolled' });

    await saveVideoProgress(
      enrollment.id,
      Number(chapter_id),
      Number(watched_seconds) || 0,
      Number(last_position_seconds) || 0
    );
    res.json({ message: 'Progress saved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save progress' });
  }
});

router.get('/:courseId/quiz/:quizId', authRequired, elearnerRequired, async (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const quizId = parseInt(req.params.quizId, 10);
    const enrollment = await getEnrollmentForUser(req.user!.id, courseId);
    if (!enrollment) return res.status(403).json({ error: 'Not enrolled' });

    const quiz = await queryOne(
      `SELECT q.id, q.title, q.pass_score, q.max_attempts, q.quiz_kind, q.chapter_id
       FROM elearning_quizzes q
       JOIN elearning_chapters ch ON ch.id = q.chapter_id
       JOIN elearning_modules m ON m.id = ch.module_id
       WHERE q.id = ? AND m.course_id = ?`,
      [quizId, courseId]
    );
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    const questions = await getQuizQuestions(quizId);
    res.json({
      ...quiz,
      questions: questions.map(sanitizeQuestionForClient),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load quiz' });
  }
});

router.post('/:courseId/quiz/:quizId/submit', authRequired, elearnerRequired, async (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const quizId = parseInt(req.params.quizId, 10);
    const { answers } = req.body;
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object required' });
    }

    const enrollment = await getEnrollmentForUser(req.user!.id, courseId);
    if (!enrollment) return res.status(403).json({ error: 'Not enrolled' });

    const result = await submitQuizAttempt(enrollment.id, quizId, answers);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'Quiz submission failed' });
  }
});

router.get('/:courseId/notes', authRequired, elearnerRequired, async (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const enrollment = await getEnrollmentForUser(req.user!.id, courseId);
    if (!enrollment) return res.status(403).json({ error: 'Not enrolled' });

    const notes = await query(
      `SELECT n.id, n.chapter_id, n.timestamp_seconds, n.note_text, n.created_at
       FROM elearning_user_notes n
       JOIN elearning_chapters ch ON ch.id = n.chapter_id
       JOIN elearning_modules m ON m.id = ch.module_id
       WHERE n.enrollment_id = ? AND n.user_id = ? AND m.course_id = ?
       ORDER BY n.created_at DESC`,
      [enrollment.id, req.user!.id, courseId]
    );
    res.json(notes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load notes' });
  }
});

router.post('/:courseId/notes', authRequired, elearnerRequired, async (req, res) => {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const { chapter_id, timestamp_seconds, note_text } = req.body;
    if (!chapter_id || !note_text?.trim()) {
      return res.status(400).json({ error: 'chapter_id and note_text required' });
    }

    const enrollment = await getEnrollmentForUser(req.user!.id, courseId);
    if (!enrollment) return res.status(403).json({ error: 'Not enrolled' });

    const id = await insert(
      `INSERT INTO elearning_user_notes (user_id, enrollment_id, chapter_id, timestamp_seconds, note_text)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user!.id, enrollment.id, chapter_id, Number(timestamp_seconds) || 0, note_text.trim()]
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

router.delete('/:courseId/notes/:noteId', authRequired, elearnerRequired, async (req, res) => {
  try {
    await pool.execute(
      `DELETE FROM elearning_user_notes WHERE id = ? AND user_id = ?`,
      [parseInt(req.params.noteId, 10), req.user!.id]
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

export default router;
