import mysql from 'mysql2/promise';
import { config } from '../config.js';

async function main() {
  console.log('=== MySQL Test ===');
  console.log(`Host: ${config.db.host}:${config.db.port}`);
  console.log(`Database: ${config.db.database}`);
  console.log(`User: ${config.db.user}`);

  try {
    const connection = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      connectTimeout: 20000,
    });

    await connection.ping();
    console.log('✓ Connection successful');

    const [versionRows] = await connection.query('SELECT VERSION() as version');
    console.log('✓ Version:', (versionRows as { version: string }[])[0]?.version);

    const [tables] = await connection.query('SHOW TABLES');
    const tableList = tables as Record<string, string>[];
    console.log(`✓ Tables: ${tableList.length}`);
    tableList.forEach((row) => console.log('  -', Object.values(row)[0]));

    await connection.end();
    console.log('\nMySQL: PASS');
  } catch (err) {
    console.error('✗ MySQL failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
