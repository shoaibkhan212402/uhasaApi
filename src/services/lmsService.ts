import { insert, pool, query, queryOne } from '../db/pool.js';

export type QuestionType =
  | 'mcq'
  | 'multiple_select'
  | 'true_false'
  | 'fill_blank'
  | 'image'
  | 'scenario';

export type ChapterRow = {
  id: number;
  module_id: number;
  title: string;
  sort_order: number;
  video_url: string | null;
  video_duration_seconds: number;
  pdf_url: string | null;
  pdf_title: string | null;
  min_watch_pct: number;
  is_module_test: number;
  module_title?: string;
  module_sort_order?: number;
  course_id?: number;
};

export type ChapterProgressRow = {
  id: number;
  enrollment_id: number;
  chapter_id: number;
  watched_seconds: number;
  max_watched_seconds: number;
  last_position_seconds: number;
  video_completed_at: string | null;
  is_completed: number;
  completed_at: string | null;
};

export type QuizCompletionRow = {
  quiz_id: number;
  passed: number;
  best_score: number;
};

export type QuizQuestionRow = {
  id: number;
  quiz_id: number;
  question_type: QuestionType;
  question_text: string;
  image_url: string | null;
  options: string | unknown;
  correct_option_id: string;
  correct_answers: string | unknown;
  sort_order: number;
};

function parseJson<T>(val: unknown, fallback: T): T {
  if (val == null) return fallback;
  if (typeof val === 'object') return val as T;
  try {
    return JSON.parse(String(val)) as T;
  } catch {
    return fallback;
  }
}

export async function getEnrollmentForUser(userId: number, courseId: number) {
  return queryOne<{ id: number; user_id: number; course_id: number; status: string }>(
    `SELECT id, user_id, course_id, status FROM elearning_enrollments WHERE user_id = ? AND course_id = ?`,
    [userId, courseId]
  );
}

/** Migrate legacy course video/lessons into modules + chapters when admin has not used the builder yet. */
export async function ensureCourseStructure(courseId: number): Promise<void> {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM elearning_modules WHERE course_id = ? LIMIT 1`,
    [courseId]
  );
  if (existing) return;

  const course = await queryOne<{
    title: string;
    video_url: string | null;
    pdf_url: string | null;
    min_watch_pct: number;
  }>(
    `SELECT title, video_url, pdf_url, min_watch_pct FROM elearning_courses WHERE id = ?`,
    [courseId]
  );
  if (!course) return;

  const lessons = await query<{
    id: number;
    title: string;
    video_url: string | null;
    pdf_url: string | null;
    duration_seconds: number;
    quiz_unlock_at_seconds: number | null;
    sort_order: number;
  }>(
    `SELECT id, title, video_url, pdf_url, duration_seconds, quiz_unlock_at_seconds, sort_order
     FROM elearning_lessons WHERE course_id = ? ORDER BY sort_order, id`,
    [courseId]
  );

  const hasContent = lessons.length > 0 || course.video_url || course.pdf_url;
  if (!hasContent) return;

  const moduleId = await insert(
    `INSERT INTO elearning_modules (course_id, title, sort_order) VALUES (?, ?, 0)`,
    [courseId, 'Course Content']
  );

  const minWatch = course.min_watch_pct ?? 90;

  if (lessons.length > 0) {
    for (let i = 0; i < lessons.length; i++) {
      const lesson = lessons[i];
      const chapterId = await insert(
        `INSERT INTO elearning_chapters
           (module_id, title, sort_order, video_url, video_duration_seconds, pdf_url, min_watch_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          moduleId,
          lesson.title,
          lesson.sort_order ?? i,
          lesson.video_url,
          lesson.duration_seconds || 0,
          lesson.pdf_url,
          minWatch,
        ]
      );

      await pool.execute(
        `UPDATE elearning_quizzes
         SET chapter_id = ?, quiz_kind = COALESCE(NULLIF(quiz_kind, 'inline'), 'chapter_end')
         WHERE lesson_id = ? AND chapter_id IS NULL`,
        [chapterId, lesson.id]
      );

      if (lesson.quiz_unlock_at_seconds != null) {
        const inlineQuiz = await queryOne<{ id: number }>(
          `SELECT id FROM elearning_quizzes WHERE lesson_id = ? ORDER BY sort_order, id LIMIT 1`,
          [lesson.id]
        );
        if (inlineQuiz) {
          await insert(
            `INSERT INTO elearning_quiz_triggers (chapter_id, quiz_id, trigger_at_seconds, is_required, sort_order)
             VALUES (?, ?, ?, 1, 0)`,
            [chapterId, inlineQuiz.id, lesson.quiz_unlock_at_seconds]
          );
        }
      }
    }
    return;
  }

  const chapterId = await insert(
    `INSERT INTO elearning_chapters
       (module_id, title, sort_order, video_url, video_duration_seconds, pdf_url, min_watch_pct)
     VALUES (?, ?, 0, ?, 0, ?, ?)`,
    [moduleId, course.title || 'Introduction', course.video_url, course.pdf_url, minWatch]
  );

  await pool.execute(
    `UPDATE elearning_quizzes
     SET chapter_id = ?, quiz_kind = 'chapter_end'
     WHERE course_id = ? AND lesson_id IS NULL AND chapter_id IS NULL`,
    [chapterId, courseId]
  );
}

export async function getOrderedChapters(courseId: number): Promise<ChapterRow[]> {
  return query<ChapterRow>(
    `SELECT ch.id, ch.module_id, ch.title, ch.sort_order, ch.video_url, ch.video_duration_seconds,
            ch.pdf_url, ch.pdf_title, ch.min_watch_pct, ch.is_module_test,
            m.title AS module_title, m.sort_order AS module_sort_order, m.course_id
     FROM elearning_chapters ch
     JOIN elearning_modules m ON m.id = ch.module_id
     WHERE m.course_id = ?
     ORDER BY m.sort_order, m.id, ch.sort_order, ch.id`,
    [courseId]
  );
}

export async function getChapterQuizzes(chapterId: number) {
  return query(
    `SELECT q.* FROM elearning_quizzes q WHERE q.chapter_id = ? ORDER BY q.sort_order, q.id`,
    [chapterId]
  );
}

export async function getQuizTriggers(chapterId: number) {
  return query<{
    id: number;
    chapter_id: number;
    quiz_id: number;
    trigger_at_seconds: number;
    is_required: number;
    sort_order: number;
    quiz_title: string;
    pass_score: number;
  }>(
    `SELECT t.id, t.chapter_id, t.quiz_id, t.trigger_at_seconds, t.is_required, t.sort_order,
            q.title AS quiz_title, q.pass_score
     FROM elearning_quiz_triggers t
     JOIN elearning_quizzes q ON q.id = t.quiz_id
     WHERE t.chapter_id = ?
     ORDER BY t.trigger_at_seconds, t.sort_order`,
    [chapterId]
  );
}

export async function getQuizQuestions(quizId: number): Promise<QuizQuestionRow[]> {
  const rows = await query<QuizQuestionRow>(
    `SELECT id, quiz_id, question_type, question_text, image_url, options, correct_option_id, correct_answers, sort_order
     FROM elearning_quiz_questions WHERE quiz_id = ? ORDER BY sort_order, id`,
    [quizId]
  );
  return rows;
}

export function sanitizeQuestionForClient(q: QuizQuestionRow) {
  const options = parseJson<{ id: string; text: string }[]>(q.options, []);
  return {
    id: q.id,
    question_type: q.question_type,
    question_text: q.question_text,
    image_url: q.image_url,
    options,
    sort_order: q.sort_order,
  };
}

function normalizeAnswer(val: unknown): string {
  return String(val ?? '').trim().toLowerCase();
}

function gradeQuestion(q: QuizQuestionRow, userAnswer: unknown): boolean {
  const correctAnswers = parseJson<string[]>(
    q.correct_answers,
    q.correct_option_id ? [q.correct_option_id] : []
  );

  switch (q.question_type) {
    case 'multiple_select': {
      const expected = new Set(correctAnswers.map(normalizeAnswer));
      const given = Array.isArray(userAnswer) ? userAnswer.map(normalizeAnswer) : [];
      if (given.length !== expected.size) return false;
      return given.every((a) => expected.has(a));
    }
    case 'fill_blank':
      return normalizeAnswer(userAnswer) === normalizeAnswer(correctAnswers[0] ?? '');
    case 'true_false':
    case 'mcq':
    case 'image':
    case 'scenario':
    default: {
      const expected = normalizeAnswer(correctAnswers[0] ?? q.correct_option_id);
      return normalizeAnswer(userAnswer) === expected;
    }
  }
}

export async function getChapterProgress(enrollmentId: number, chapterId: number) {
  return queryOne<ChapterProgressRow>(
    `SELECT * FROM elearning_chapter_progress WHERE enrollment_id = ? AND chapter_id = ?`,
    [enrollmentId, chapterId]
  );
}

export async function getQuizCompletion(enrollmentId: number, quizId: number) {
  return queryOne<{ passed: number; best_score: number; attempts_count: number }>(
    `SELECT passed, best_score, attempts_count FROM elearning_quiz_completions WHERE enrollment_id = ? AND quiz_id = ?`,
    [enrollmentId, quizId]
  );
}

export async function isChapterVideoComplete(
  enrollmentId: number,
  chapter: ChapterRow
): Promise<boolean> {
  const progress = await getChapterProgress(enrollmentId, chapter.id);
  if (!progress) return false;
  if (progress.is_completed) return true;
  const duration = chapter.video_duration_seconds || 0;
  if (!chapter.video_url || duration <= 0) return true;
  const minPct = chapter.min_watch_pct || 90;
  const threshold = Math.floor((duration * minPct) / 100);
  return Number(progress.max_watched_seconds) >= threshold;
}

export async function areChapterQuizzesPassed(enrollmentId: number, chapterId: number): Promise<boolean> {
  const triggers = await query<{ quiz_id: number; is_required: number }>(
    `SELECT quiz_id, is_required FROM elearning_quiz_triggers WHERE chapter_id = ? AND is_required = 1`,
    [chapterId]
  );
  const endQuizzes = await query<{ id: number }>(
    `SELECT id FROM elearning_quizzes WHERE chapter_id = ? AND quiz_kind IN ('chapter_end', 'module_test')`,
    [chapterId]
  );

  const requiredQuizIds = [
    ...triggers.map((t) => t.quiz_id),
    ...endQuizzes.map((q) => q.id),
  ];

  if (requiredQuizIds.length === 0) return true;

  for (const quizId of requiredQuizIds) {
    const completion = await getQuizCompletion(enrollmentId, quizId);
    if (!completion || completion.passed !== 1) return false;
  }
  return true;
}

export async function evaluateChapterCompletion(enrollmentId: number, chapterId: number) {
  const chapter = await queryOne<ChapterRow>(
    `SELECT ch.*, m.course_id FROM elearning_chapters ch JOIN elearning_modules m ON m.id = ch.module_id WHERE ch.id = ?`,
    [chapterId]
  );
  if (!chapter) return false;

  const videoDone = await isChapterVideoComplete(enrollmentId, chapter);
  const quizzesDone = await areChapterQuizzesPassed(enrollmentId, chapterId);
  const complete = videoDone && quizzesDone;

  if (complete) {
    await pool.execute(
      `INSERT INTO elearning_chapter_progress (enrollment_id, chapter_id, is_completed, completed_at, video_completed_at)
       VALUES (?, ?, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE is_completed = 1, completed_at = COALESCE(completed_at, NOW()), video_completed_at = COALESCE(video_completed_at, NOW())`,
      [enrollmentId, chapterId]
    );
    await checkCourseCompletion(enrollmentId, chapter.course_id!);
  }

  return complete;
}

export async function isChapterUnlocked(enrollmentId: number, chapterId: number, chapters?: ChapterRow[]) {
  const ordered = chapters ?? (await (async () => {
    const ch = await queryOne<{ course_id: number }>(
      `SELECT m.course_id FROM elearning_chapters ch JOIN elearning_modules m ON m.id = ch.module_id WHERE ch.id = ?`,
      [chapterId]
    );
    if (!ch) return [];
    return getOrderedChapters(ch.course_id);
  })());

  const idx = ordered.findIndex((c) => c.id === chapterId);
  if (idx <= 0) return true;

  const prev = ordered[idx - 1];
  const prevProgress = await queryOne<{ is_completed: number }>(
    `SELECT is_completed FROM elearning_chapter_progress WHERE enrollment_id = ? AND chapter_id = ?`,
    [enrollmentId, prev.id]
  );
  return prevProgress?.is_completed === 1;
}

export async function saveVideoProgress(
  enrollmentId: number,
  chapterId: number,
  watchedSeconds: number,
  lastPositionSeconds: number
) {
  const chapter = await queryOne<ChapterRow>(
    `SELECT * FROM elearning_chapters WHERE id = ?`,
    [chapterId]
  );
  if (!chapter) throw new Error('Chapter not found');

  const maxWatched = Math.max(watchedSeconds, lastPositionSeconds);
  await pool.execute(
    `INSERT INTO elearning_chapter_progress (enrollment_id, chapter_id, watched_seconds, max_watched_seconds, last_position_seconds)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       watched_seconds = GREATEST(watched_seconds, VALUES(watched_seconds)),
       max_watched_seconds = GREATEST(max_watched_seconds, VALUES(max_watched_seconds)),
       last_position_seconds = VALUES(last_position_seconds),
       updated_at = NOW()`,
    [enrollmentId, chapterId, watchedSeconds, maxWatched, lastPositionSeconds]
  );

  const duration = chapter.video_duration_seconds || 0;
  const minPct = chapter.min_watch_pct || 90;
  if (duration > 0 && maxWatched >= Math.floor((duration * minPct) / 100)) {
    await pool.execute(
      `UPDATE elearning_chapter_progress SET video_completed_at = COALESCE(video_completed_at, NOW()) WHERE enrollment_id = ? AND chapter_id = ?`,
      [enrollmentId, chapterId]
    );
  }

  await evaluateChapterCompletion(enrollmentId, chapterId);
}

export async function submitQuizAttempt(
  enrollmentId: number,
  quizId: number,
  answers: Record<number, unknown>
) {
  const quiz = await queryOne<{ id: number; pass_score: number; max_attempts: number; chapter_id: number | null }>(
    `SELECT id, pass_score, max_attempts, chapter_id FROM elearning_quizzes WHERE id = ?`,
    [quizId]
  );
  if (!quiz) throw new Error('Quiz not found');

  const existing = await getQuizCompletion(enrollmentId, quizId);
  if (existing && existing.attempts_count >= quiz.max_attempts && existing.passed !== 1) {
    throw new Error('Maximum quiz attempts reached');
  }

  const questions = await getQuizQuestions(quizId);
  if (!questions.length) throw new Error('Quiz has no questions');

  let correct = 0;
  for (const q of questions) {
    if (gradeQuestion(q, answers[q.id])) correct++;
  }

  const score = Math.round((correct / questions.length) * 100);
  const passed = score >= (quiz.pass_score || 60);

  await insert(
    `INSERT INTO elearning_quiz_attempts (enrollment_id, quiz_id, score, total_questions, passed, answers)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [enrollmentId, quizId, score, questions.length, passed ? 1 : 0, JSON.stringify(answers)]
  );

  await pool.execute(
    `INSERT INTO elearning_quiz_completions (enrollment_id, quiz_id, passed, best_score, attempts_count, completed_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       passed = GREATEST(passed, VALUES(passed)),
       best_score = GREATEST(best_score, VALUES(best_score)),
       attempts_count = attempts_count + 1,
       completed_at = CASE WHEN VALUES(passed) = 1 THEN COALESCE(completed_at, NOW()) ELSE completed_at END`,
    [enrollmentId, quizId, passed ? 1 : 0, score, passed ? new Date() : null]
  );

  if (quiz.chapter_id) {
    await evaluateChapterCompletion(enrollmentId, quiz.chapter_id);
  }

  return { score, total: questions.length, passed, pass_score: quiz.pass_score };
}

async function checkCourseCompletion(enrollmentId: number, courseId: number) {
  const chapters = await getOrderedChapters(courseId);
  if (!chapters.length) return;

  for (const ch of chapters) {
    const prog = await queryOne<{ is_completed: number }>(
      `SELECT is_completed FROM elearning_chapter_progress WHERE enrollment_id = ? AND chapter_id = ?`,
      [enrollmentId, ch.id]
    );
    if (!prog || prog.is_completed !== 1) return;
  }

  await pool.execute(
    `UPDATE elearning_enrollments SET status = 'completed', completed_at = COALESCE(completed_at, NOW()) WHERE id = ?`,
    [enrollmentId]
  );

  await pool.execute(
    `INSERT IGNORE INTO elearning_certificates (enrollment_id) VALUES (?)`,
    [enrollmentId]
  );
}

export async function buildPlayerPayload(enrollmentId: number, courseId: number, userId: number) {
  const course = await queryOne(
    `SELECT id, title, description, hours, min_watch_pct, pass_score FROM elearning_courses WHERE id = ?`,
    [courseId]
  );
  if (!course) throw new Error('Course not found');

  await ensureCourseStructure(courseId);

  const modules = await query<{ id: number; title: string; description: string | null; sort_order: number }>(
    `SELECT id, title, description, sort_order FROM elearning_modules WHERE course_id = ? ORDER BY sort_order, id`,
    [courseId]
  );

  const chapters = await getOrderedChapters(courseId);
  const progressRows = await query<ChapterProgressRow>(
    `SELECT * FROM elearning_chapter_progress WHERE enrollment_id = ?`,
    [enrollmentId]
  );
  const progressMap = new Map(progressRows.map((p) => [p.chapter_id, p]));

  const completions = await query<QuizCompletionRow>(
    `SELECT quiz_id, passed, best_score FROM elearning_quiz_completions WHERE enrollment_id = ?`,
    [enrollmentId]
  );
  const completionMap = new Map(completions.map((c) => [c.quiz_id, c]));

  const structure = await Promise.all(
    modules.map(async (mod) => {
      const modChapters = chapters.filter((c) => c.module_id === mod.id);
      const chapterPayload = await Promise.all(
        modChapters.map(async (ch) => {
          const unlocked = await isChapterUnlocked(enrollmentId, ch.id, chapters);
          const prog = progressMap.get(ch.id);
          const triggers = await getQuizTriggers(ch.id);
          const endQuiz = await queryOne<{ id: number; title: string; pass_score: number }>(
            `SELECT id, title, pass_score FROM elearning_quizzes WHERE chapter_id = ? AND quiz_kind = 'chapter_end' LIMIT 1`,
            [ch.id]
          );

          return {
            id: ch.id,
            title: ch.title,
            sort_order: ch.sort_order,
            video_url: ch.video_url,
            video_duration_seconds: ch.video_duration_seconds,
            pdf_url: ch.pdf_url,
            pdf_title: ch.pdf_title,
            min_watch_pct: ch.min_watch_pct,
            is_module_test: ch.is_module_test === 1,
            unlocked,
            progress: prog
              ? {
                  watched_seconds: prog.watched_seconds,
                  max_watched_seconds: prog.max_watched_seconds,
                  last_position_seconds: prog.last_position_seconds,
                  is_completed: prog.is_completed === 1,
                  video_completed_at: prog.video_completed_at,
                }
              : null,
            quiz_triggers: triggers.map((t: { quiz_id: number; trigger_at_seconds: number; is_required: number; quiz_title: string; pass_score: number }) => ({
              quiz_id: t.quiz_id,
              trigger_at_seconds: t.trigger_at_seconds,
              is_required: t.is_required === 1,
              title: t.quiz_title,
              pass_score: t.pass_score,
              passed: completionMap.get(t.quiz_id)?.passed === 1,
            })),
            end_quiz: endQuiz
              ? {
                  ...endQuiz,
                  passed: completionMap.get(endQuiz.id)?.passed === 1,
                }
              : null,
          };
        })
      );
      return { ...mod, chapters: chapterPayload };
    })
  );

  const notes = await query(
    `SELECT id, chapter_id, timestamp_seconds, note_text, created_at
     FROM elearning_user_notes WHERE enrollment_id = ? AND user_id = ? ORDER BY created_at DESC`,
    [enrollmentId, userId]
  );

  return { course, enrollment_id: enrollmentId, modules: structure, notes };
}
