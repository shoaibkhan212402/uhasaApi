import mysql from 'mysql2/promise';
import { config } from '../config.js';

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS elearning_modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES elearning_courses(id) ON DELETE CASCADE,
  INDEX idx_modules_course (course_id)
)`,

  `CREATE TABLE IF NOT EXISTS elearning_chapters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  module_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  video_url VARCHAR(1000) NULL,
  video_duration_seconds INT NOT NULL DEFAULT 0,
  pdf_url VARCHAR(1000) NULL,
  pdf_title VARCHAR(500) NULL,
  min_watch_pct INT NOT NULL DEFAULT 90,
  is_module_test TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (module_id) REFERENCES elearning_modules(id) ON DELETE CASCADE,
  INDEX idx_chapters_module (module_id)
)`,

  `CREATE TABLE IF NOT EXISTS elearning_quiz_triggers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chapter_id INT NOT NULL,
  quiz_id INT NOT NULL,
  trigger_at_seconds INT NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chapter_id) REFERENCES elearning_chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (quiz_id) REFERENCES elearning_quizzes(id) ON DELETE CASCADE,
  INDEX idx_triggers_chapter (chapter_id)
)`,

  `CREATE TABLE IF NOT EXISTS elearning_chapter_progress (
  id INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_id INT NOT NULL,
  chapter_id INT NOT NULL,
  watched_seconds INT NOT NULL DEFAULT 0,
  max_watched_seconds INT NOT NULL DEFAULT 0,
  last_position_seconds INT NOT NULL DEFAULT 0,
  video_completed_at TIMESTAMP NULL,
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  completed_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_chapter_progress (enrollment_id, chapter_id),
  FOREIGN KEY (enrollment_id) REFERENCES elearning_enrollments(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES elearning_chapters(id) ON DELETE CASCADE
)`,

  `CREATE TABLE IF NOT EXISTS elearning_quiz_completions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_id INT NOT NULL,
  quiz_id INT NOT NULL,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  best_score INT NOT NULL DEFAULT 0,
  attempts_count INT NOT NULL DEFAULT 0,
  completed_at TIMESTAMP NULL,
  UNIQUE KEY uk_quiz_completion (enrollment_id, quiz_id),
  FOREIGN KEY (enrollment_id) REFERENCES elearning_enrollments(id) ON DELETE CASCADE,
  FOREIGN KEY (quiz_id) REFERENCES elearning_quizzes(id) ON DELETE CASCADE
)`,

  `CREATE TABLE IF NOT EXISTS elearning_user_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  enrollment_id INT NOT NULL,
  chapter_id INT NOT NULL,
  timestamp_seconds INT NOT NULL DEFAULT 0,
  note_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (enrollment_id) REFERENCES elearning_enrollments(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES elearning_chapters(id) ON DELETE CASCADE,
  INDEX idx_notes_enrollment (enrollment_id)
)`,

  `ALTER TABLE elearning_quizzes ADD COLUMN chapter_id INT NULL`,
  `ALTER TABLE elearning_quizzes ADD COLUMN module_id INT NULL`,
  `ALTER TABLE elearning_quizzes ADD COLUMN quiz_kind ENUM('inline', 'chapter_end', 'module_test', 'course_final') NOT NULL DEFAULT 'inline'`,
  `ALTER TABLE elearning_quiz_questions ADD COLUMN question_type ENUM('mcq', 'multiple_select', 'true_false', 'fill_blank', 'image', 'scenario') NOT NULL DEFAULT 'mcq'`,
  `ALTER TABLE elearning_quiz_questions ADD COLUMN image_url VARCHAR(1000) NULL`,
  `ALTER TABLE elearning_quiz_questions ADD COLUMN correct_answers JSON NULL`,
];

const c = await mysql.createConnection({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  multipleStatements: true,
});

const ignorable = new Set(['ER_DUP_FIELDNAME', 'ER_TABLE_EXISTS_ERROR']);

for (const st of statements) {
  try {
    await c.query(st);
    const label = st.match(/(?:TABLE IF NOT EXISTS|TABLE)\s+(\w+)/i)?.[1]
      ?? st.match(/ALTER TABLE\s+(\w+)/i)?.[1]
      ?? st.slice(0, 40);
    console.log('OK:', label);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code && ignorable.has(err.code)) {
      console.log('SKIP (exists):', err.message);
      continue;
    }
    console.error('FAIL:', err.message);
    console.error('SQL:', st.slice(0, 120));
  }
}

const tables = [
  'elearning_modules',
  'elearning_chapters',
  'elearning_quiz_triggers',
  'elearning_chapter_progress',
  'elearning_quiz_completions',
  'elearning_user_notes',
];

for (const table of tables) {
  const [rows] = await c.query(`SHOW TABLES LIKE ?`, [table]);
  console.log(`${table}:`, (rows as unknown[]).length > 0 ? 'exists' : 'MISSING');
}

await c.end();
