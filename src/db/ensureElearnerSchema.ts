import mysql from 'mysql2/promise';
import { config } from '../config.js';

const IGNORABLE = new Set([
  'ER_DUP_FIELDNAME',
  'ER_TABLE_EXISTS_ERROR',
  'ER_DUP_KEYNAME',
  'ER_CANT_DROP_FIELD_OR_KEY',
  'ER_CANT_CREATE_TABLE',
]);

const statements: string[] = [
  `ALTER TABLE users ADD COLUMN is_uasa_member TINYINT(1) NOT NULL DEFAULT 0`,

  `ALTER TABLE elearning_courses ADD COLUMN workshop_id INT NULL`,
  `ALTER TABLE elearning_courses ADD COLUMN price DECIMAL(10, 2) NOT NULL DEFAULT 0`,
  `ALTER TABLE elearning_courses ADD COLUMN enrollment_type ENUM('open', 'paid', 'both') NOT NULL DEFAULT 'open'`,
  `ALTER TABLE elearning_courses ADD COLUMN pass_score INT NOT NULL DEFAULT 60`,
  `ALTER TABLE elearning_courses ADD COLUMN min_watch_pct INT NOT NULL DEFAULT 90`,
  `ALTER TABLE elearning_courses ADD COLUMN quiz_unlock_mode ENUM('on_completion', 'at_timestamp', 'both') NOT NULL DEFAULT 'on_completion'`,
  `ALTER TABLE elearning_courses ADD COLUMN certificate_note TEXT NULL`,

  `CREATE TABLE IF NOT EXISTS elearning_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  course_id INT NOT NULL,
  status ENUM('active', 'completed', 'expired') NOT NULL DEFAULT 'active',
  payment_reference VARCHAR(255) NULL,
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  UNIQUE KEY uk_elearning_enrollment (user_id, course_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES elearning_courses(id) ON DELETE CASCADE,
  INDEX idx_enrollments_user (user_id),
  INDEX idx_enrollments_course (course_id)
)`,
];

async function runStatements(connection: mysql.Connection) {
  for (const statement of statements) {
    try {
      await connection.query(statement);
      const label =
        statement.match(/(?:TABLE IF NOT EXISTS|TABLE)\s+(\w+)/i)?.[1]
        ?? statement.match(/ALTER TABLE\s+(\w+)/i)?.[1]
        ?? statement.slice(0, 48);
      console.log('[elearner-schema] OK:', label);
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      if (IGNORABLE.has(code)) {
        console.log('[elearner-schema] SKIP (exists)');
        continue;
      }
      console.error('[elearner-schema] FAIL:', err instanceof Error ? err.message : err);
    }
  }
}

/** Idempotently add e-learner pricing/enrollment columns missing from older DBs. */
export async function ensureElearnerSchema(): Promise<void> {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: false,
  });

  try {
    await runStatements(connection);
  } finally {
    await connection.end();
  }
}

const isDirectRun = process.argv[1]?.includes('ensureElearnerSchema');
if (isDirectRun) {
  ensureElearnerSchema()
    .then(() => {
      console.log('E-learner schema ensure complete.');
    })
    .catch((err) => {
      console.error('E-learner schema ensure failed:', err);
      process.exit(1);
    });
}
