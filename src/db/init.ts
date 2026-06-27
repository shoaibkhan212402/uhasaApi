import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function init() {
  const schemaPath = path.join(__dirname, '../../database/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
  });

  const tablesOnly = schema
    .replace(/CREATE DATABASE IF NOT EXISTS[\s\S]*?;/i, '')
    .replace(/USE\s+\w+\s*;/i, '');

  console.log(`Running database schema on ${config.db.database}...`);
  await connection.query(tablesOnly);

  const hash = await bcrypt.hash(config.admin.password, 10);
  await connection.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES (?, ?, 'Administrator', 'admin')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [config.admin.email, hash]
  );

  await connection.end();
  console.log(`Database initialized. Admin: ${config.admin.email}`);
}

init().catch((err) => {
  console.error('Database init failed:', err);
  process.exit(1);
});
