import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IGNORABLE_CODES = new Set([
  'ER_DUP_FIELDNAME',
  'ER_TABLE_EXISTS_ERROR',
  'ER_DUP_KEYNAME',
  'ER_CANT_DROP_FIELD_OR_KEY',
  'ER_CANT_CREATE_TABLE', // duplicate FK / constraint already exists (errno 121)
]);

async function migrate() {
  const migrationsDir = path.join(__dirname, '../../database/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: false,
  });

  for (const file of files) {
    const migrationPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    const statements = sql
      .split(';')
      .map((s) => {
        const lines = s.split('\n').map((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('--') || trimmed.startsWith('#')) {
            return '';
          }
          return line;
        });
        return lines.join('\n').trim();
      })
      .filter((s) => s !== '');

    console.log(`Running migration ${file} on ${config.db.database}...`);

    for (const statement of statements) {
      try {
        await connection.query(statement);
        console.log('OK:', statement.slice(0, 60).replace(/\s+/g, ' ') + '...');
      } catch (err: unknown) {
        const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
        if (IGNORABLE_CODES.has(code)) {
          console.log('SKIP (already applied):', statement.slice(0, 50).replace(/\s+/g, ' ') + '...');
          continue;
        }
        throw err;
      }
    }
  }

  await connection.end();
  console.log('Migration complete.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
