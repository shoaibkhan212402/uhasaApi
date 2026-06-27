import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../database/migrations/016_payments.sql'),
    'utf-8'
  );

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  try {
    await connection.query(sql.trim());
    const [rows] = await connection.query('SHOW TABLES LIKE "payments"');
    console.log('payments table created:', Array.isArray(rows) && rows.length > 0 ? 'yes' : 'no');
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
