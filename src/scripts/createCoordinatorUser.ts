import bcrypt from 'bcryptjs';
import { insert, queryOne } from '../db/pool.js';

async function run() {
  const email = 'coordinator@uasatraining.com';
  const name = 'UASA Coordinator';
  const password = 'Demo@123';
  const role = 'coordinator';

  // Check if exists
  const existing = await queryOne(`SELECT id FROM users WHERE email = ?`, [email]);
  if (existing) {
    console.log(`User ${email} already exists!`);
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const id = await insert(
    `INSERT INTO users (email, password_hash, name, role, is_active, must_change_password) VALUES (?, ?, ?, ?, 1, 0)`,
    [email, hash, name, role]
  );
  console.log(`Created coordinator user with ID: ${id}`);
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
