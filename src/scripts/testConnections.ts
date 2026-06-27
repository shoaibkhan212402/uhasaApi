import mysql from 'mysql2/promise';
import { Client } from 'basic-ftp';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config.js';

async function testMySQL() {
  console.log('\n=== MySQL Test ===');
  console.log(`Host: ${config.db.host}:${config.db.port}`);
  console.log(`Database: ${config.db.database}`);
  console.log(`User: ${config.db.user}`);

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectTimeout: 20000,
  });

  await connection.ping();
  console.log('✓ Connection successful (ping OK)');

  const [versionRows] = await connection.query('SELECT VERSION() as version');
  console.log('✓ Server version:', (versionRows as { version: string }[])[0]?.version);

  const [tables] = await connection.query('SHOW TABLES');
  const tableList = tables as Record<string, string>[];
  console.log(`✓ Tables found: ${tableList.length}`);
  tableList.forEach((row) => console.log('  -', Object.values(row)[0]));

  await connection.end();
  return { ok: true, tableCount: tableList.length };
}

async function tryFtp(label: string, options: { secure?: boolean | 'implicit'; port?: number }) {
  console.log(`\n--- FTP attempt: ${label} ---`);
  const client = new Client(30000);
  client.ftp.verbose = false;

  await client.access({
    host: config.ftp.host,
    port: options.port ?? config.ftp.port,
    user: config.ftp.user,
    password: config.ftp.password,
    secure: options.secure ?? false,
  });
  console.log('✓ Login OK');

  await client.ensureDir(config.ftp.basePath);
  const listing = await client.list(config.ftp.basePath);
  console.log(`✓ Listed ${listing.length} items in ${config.ftp.basePath}`);

  const testDir = `${config.ftp.basePath}/uploads`.replace(/\/+/g, '/');
  await client.ensureDir(testDir);

  const tmpFile = path.join(os.tmpdir(), 'uasa-ftp-test.txt');
  fs.writeFileSync(tmpFile, `UASA FTP test ${new Date().toISOString()}`);
  const remoteName = `test-${Date.now()}.txt`;
  const remotePath = `${testDir}/${remoteName}`;

  await client.uploadFrom(tmpFile, remotePath);
  console.log('✓ Upload OK:', remotePath);

  await client.remove(remotePath);
  console.log('✓ Cleanup OK');

  fs.unlinkSync(tmpFile);
  client.close();
  return true;
}

async function testFTP() {
  console.log('\n=== FTP Test ===');
  console.log(`Host: ${config.ftp.host}`);
  console.log(`User: ${config.ftp.user}`);
  console.log(`Base path: ${config.ftp.basePath}`);
  console.log(`Public URL: ${config.ftp.publicUrl}`);

  const attempts: Array<{ label: string; options: { secure?: boolean | 'implicit'; port?: number } }> = [
    { label: 'Plain FTP (port 21)', options: { secure: false, port: 21 } },
    { label: 'Explicit FTPS (port 21)', options: { secure: true, port: 21 } },
    { label: 'Implicit FTPS (port 990)', options: { secure: 'implicit', port: 990 } },
  ];

  const errors: string[] = [];
  for (const { label, options } of attempts) {
    try {
      await tryFtp(label, options);
      console.log(`\n✓ FTP working with: ${label}`);
      return { ok: true, mode: label };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${label}: ${msg}`);
      errors.push(`${label}: ${msg}`);
    }
  }

  throw new Error(errors.join(' | '));
}

async function main() {
  const results: Record<string, { ok: boolean; error?: string; detail?: string }> = {};

  try {
    const r = await testMySQL();
    results.mysql = { ok: true, detail: `${r.tableCount} tables` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('✗ MySQL failed:', msg);
    results.mysql = { ok: false, error: msg };
  }

  try {
    const r = await testFTP();
    results.ftp = { ok: true, detail: r.mode };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n✗ All FTP attempts failed');
    results.ftp = { ok: false, error: msg };
  }

  console.log('\n=== Summary ===');
  console.log(`MySQL: ${results.mysql?.ok ? 'PASS' : 'FAIL'}${results.mysql?.detail ? ` (${results.mysql.detail})` : ''}`);
  if (results.mysql?.error) console.log(`  → ${results.mysql.error}`);
  console.log(`FTP:   ${results.ftp?.ok ? 'PASS' : 'FAIL'}${results.ftp?.detail ? ` (${results.ftp.detail})` : ''}`);
  if (results.ftp?.error) console.log(`  → ${results.ftp.error}`);

  if (!results.mysql?.ok || !results.ftp?.ok) process.exit(1);
}

main();
