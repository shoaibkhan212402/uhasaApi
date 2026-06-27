import mysql from 'mysql2/promise';
import { config } from '../config.js';

const c = await mysql.createConnection({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

const tables = ['elearning_modules', 'elearning_chapters', 'elearning_quiz_triggers'];
for (const t of tables) {
  const [rows] = await c.query(`SHOW TABLES LIKE '${t}'`);
  console.log(t, (rows as unknown[]).length ? 'OK' : 'MISSING');
}

try {
  await c.query('SELECT id FROM elearning_modules LIMIT 1');
  console.log('elearning_modules query OK');
} catch (e) {
  console.log('elearning_modules query FAIL:', (e as Error).message);
}

try {
  await c.query(`SELECT q.id, q.chapter_id, q.quiz_kind FROM elearning_quizzes q LIMIT 1`);
  console.log('quizzes columns OK');
} catch (e) {
  console.log('quizzes columns FAIL:', (e as Error).message);
}

try {
  await c.query(`SELECT id, question_type FROM elearning_quiz_questions LIMIT 1`);
  console.log('questions columns OK');
} catch (e) {
  console.log('questions columns FAIL:', (e as Error).message);
}

await c.end();
