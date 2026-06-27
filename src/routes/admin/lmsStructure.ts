import { Router, type Request } from 'express';
import { insert, pool, query, queryOne } from '../../db/pool.js';

const router = Router({ mergeParams: true });

function courseIdParam(req: Request): number {
  return parseInt(String(req.params.courseId), 10);
}

router.get('/', async (req, res) => {
  try {
    const courseId = courseIdParam(req);
    const modules = await query<{ id: number; course_id: number; title: string; description: string | null; sort_order: number }>(
      `SELECT id, course_id, title, description, sort_order FROM elearning_modules WHERE course_id = ? ORDER BY sort_order, id`,
      [courseId]
    );

    const structure = await Promise.all(
      modules.map(async (mod) => {
        const chapters = await query<{
          id: number; module_id: number; title: string; sort_order: number;
          video_url: string | null; video_duration_seconds: number; pdf_url: string | null;
          pdf_title: string | null; min_watch_pct: number; is_module_test: number;
        }>(
          `SELECT id, module_id, title, sort_order, video_url, video_duration_seconds, pdf_url, pdf_title, min_watch_pct, is_module_test
           FROM elearning_chapters WHERE module_id = ? ORDER BY sort_order, id`,
          [mod.id]
        );

        const chaptersWithQuizzes = await Promise.all(
          chapters.map(async (ch) => {
            const triggers = await query(
              `SELECT t.id, t.quiz_id, t.trigger_at_seconds, t.is_required, t.sort_order, q.title
               FROM elearning_quiz_triggers t JOIN elearning_quizzes q ON q.id = t.quiz_id
               WHERE t.chapter_id = ? ORDER BY t.trigger_at_seconds`,
              [ch.id]
            );
            const quizzes = await query<{ id: number; title: string; pass_score: number; max_attempts: number; quiz_kind: string; sort_order: number }>(
              `SELECT q.id, q.title, q.pass_score, q.max_attempts, q.quiz_kind, q.sort_order
               FROM elearning_quizzes q WHERE q.chapter_id = ? ORDER BY q.sort_order, q.id`,
              [ch.id]
            );
            const quizzesWithQuestions = await Promise.all(
              quizzes.map(async (q: { id: number; title: string; pass_score: number; max_attempts: number; quiz_kind: string; sort_order: number }) => {
                const questions = await query(
                  `SELECT id, question_type, question_text, image_url, options, correct_option_id, correct_answers, sort_order
                   FROM elearning_quiz_questions WHERE quiz_id = ? ORDER BY sort_order, id`,
                  [q.id]
                );
                return { ...q, questions };
              })
            );
            return { ...ch, triggers, quizzes: quizzesWithQuestions };
          })
        );

        return { ...mod, chapters: chaptersWithQuizzes };
      })
    );

    res.json({ modules: structure });
  } catch (err) {
    console.error('Load course structure failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to load course structure';
    res.status(500).json({
      error: 'Failed to load course structure',
      details: message,
    });
  }
});

router.post('/modules', async (req, res) => {
  try {
    const courseId = courseIdParam(req);
    const { title, description, sort_order } = req.body;
    const id = await insert(
      `INSERT INTO elearning_modules (course_id, title, description, sort_order) VALUES (?, ?, ?, ?)`,
      [courseId, title, description || null, sort_order ?? 0]
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create module' });
  }
});

router.put('/modules/:moduleId', async (req, res) => {
  try {
    const { title, description, sort_order } = req.body;
    await pool.execute(
      `UPDATE elearning_modules SET title=?, description=?, sort_order=? WHERE id=? AND course_id=?`,
      [title, description || null, sort_order ?? 0, req.params.moduleId, courseIdParam(req)]
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update module' });
  }
});

router.delete('/modules/:moduleId', async (req, res) => {
  try {
    await pool.execute(`DELETE FROM elearning_modules WHERE id=? AND course_id=?`, [
      req.params.moduleId,
      courseIdParam(req),
    ]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete module' });
  }
});

router.post('/modules/:moduleId/chapters', async (req, res) => {
  try {
    const b = req.body;
    const id = await insert(
      `INSERT INTO elearning_chapters (module_id, title, sort_order, video_url, video_duration_seconds, pdf_url, pdf_title, min_watch_pct, is_module_test)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.moduleId,
        b.title,
        b.sort_order ?? 0,
        b.video_url || null,
        b.video_duration_seconds ?? 0,
        b.pdf_url || null,
        b.pdf_title || null,
        b.min_watch_pct ?? 90,
        b.is_module_test ? 1 : 0,
      ]
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create chapter' });
  }
});

router.put('/chapters/:chapterId', async (req, res) => {
  try {
    const b = req.body;
    await pool.execute(
      `UPDATE elearning_chapters SET title=?, sort_order=?, video_url=?, video_duration_seconds=?, pdf_url=?, pdf_title=?, min_watch_pct=?, is_module_test=?
       WHERE id=?`,
      [
        b.title,
        b.sort_order ?? 0,
        b.video_url || null,
        b.video_duration_seconds ?? 0,
        b.pdf_url || null,
        b.pdf_title || null,
        b.min_watch_pct ?? 90,
        b.is_module_test ? 1 : 0,
        req.params.chapterId,
      ]
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update chapter' });
  }
});

router.delete('/chapters/:chapterId', async (req, res) => {
  try {
    await pool.execute(`DELETE FROM elearning_chapters WHERE id=?`, [req.params.chapterId]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete chapter' });
  }
});

router.post('/chapters/:chapterId/quizzes', async (req, res) => {
  try {
    const b = req.body;
    const chapterId = parseInt(req.params.chapterId, 10);
    const chapter = await queryOne<{ module_id: number }>(
      `SELECT module_id FROM elearning_chapters WHERE id = ?`,
      [chapterId]
    );
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    const quizId = await insert(
      `INSERT INTO elearning_quizzes (chapter_id, module_id, course_id, title, pass_score, max_attempts, quiz_kind, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chapterId,
        chapter.module_id,
        courseIdParam(req),
        b.title || 'Quiz',
        b.pass_score ?? 60,
        b.max_attempts ?? 3,
        b.quiz_kind || 'inline',
        b.sort_order ?? 0,
      ]
    );

    if (b.questions?.length) {
      for (const [idx, q] of b.questions.entries()) {
        await insert(
          `INSERT INTO elearning_quiz_questions (quiz_id, question_type, question_text, image_url, options, correct_option_id, correct_answers, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            quizId,
            q.question_type || 'mcq',
            q.question_text,
            q.image_url || null,
            JSON.stringify(q.options || []),
            q.correct_option_id || '',
            JSON.stringify(q.correct_answers || (q.correct_option_id ? [q.correct_option_id] : [])),
            q.sort_order ?? idx,
          ]
        );
      }
    }

    if (b.trigger_at_seconds != null && b.quiz_kind === 'inline') {
      await insert(
        `INSERT INTO elearning_quiz_triggers (chapter_id, quiz_id, trigger_at_seconds, is_required, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [chapterId, quizId, b.trigger_at_seconds, b.is_required !== false ? 1 : 0, b.sort_order ?? 0]
      );
    }

    res.status(201).json({ id: quizId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create quiz' });
  }
});

router.put('/quizzes/:quizId', async (req, res) => {
  try {
    const b = req.body;
    await pool.execute(
      `UPDATE elearning_quizzes SET title=?, pass_score=?, max_attempts=?, quiz_kind=?, sort_order=? WHERE id=?`,
      [b.title, b.pass_score ?? 60, b.max_attempts ?? 3, b.quiz_kind || 'inline', b.sort_order ?? 0, req.params.quizId]
    );

    if (Array.isArray(b.questions)) {
      await pool.execute(`DELETE FROM elearning_quiz_questions WHERE quiz_id = ?`, [req.params.quizId]);
      for (const [idx, q] of b.questions.entries()) {
        await insert(
          `INSERT INTO elearning_quiz_questions (quiz_id, question_type, question_text, image_url, options, correct_option_id, correct_answers, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.params.quizId,
            q.question_type || 'mcq',
            q.question_text,
            q.image_url || null,
            JSON.stringify(q.options || []),
            q.correct_option_id || '',
            JSON.stringify(q.correct_answers || (q.correct_option_id ? [q.correct_option_id] : [])),
            q.sort_order ?? idx,
          ]
        );
      }
    }

    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update quiz' });
  }
});

router.delete('/quizzes/:quizId', async (req, res) => {
  try {
    await pool.execute(`DELETE FROM elearning_quiz_triggers WHERE quiz_id = ?`, [req.params.quizId]);
    await pool.execute(`DELETE FROM elearning_quizzes WHERE id = ?`, [req.params.quizId]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete quiz' });
  }
});

export default router;
