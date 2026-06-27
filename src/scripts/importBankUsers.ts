import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.resolve(__dirname, '../../../docs/migrated-data/corporate-users-bank.sql');

type LegacyBank = {
  legacyId: number;
  name: string;
};

type LegacyBankUser = {
  legacyId: number;
  name: string;
  email: string;
  password: string;
  bankId: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
};

type ImportSummary = {
  dryRun: boolean;
  banksParsed: number;
  banksImported: number;
  banksUpdated: number;
  usersParsed: number;
  usersImported: number;
  usersUpdated: number;
  usersSkipped: number;
  errors: { legacyId: number; email: string; error: string }[];
};

function parseSqlStringLiteral(input: string, start: number): { value: string; next: number } {
  let i = start;
  if (input[i] === 'N') i += 1;
  if (input[i] !== "'") throw new Error(`Expected string at ${start}`);
  i += 1;

  let value = '';
  while (i < input.length) {
    const ch = input[i];
    if (ch === "'") {
      if (input[i + 1] === "'") {
        value += "'";
        i += 2;
        continue;
      }
      return { value, next: i + 1 };
    }
    value += ch;
    i += 1;
  }
  throw new Error('Unterminated SQL string');
}

function parseCastDateTime(input: string, start: number): { value: string | null; next: number } {
  const open = input.indexOf('(', start);
  const close = input.indexOf(')', open);
  if (open === -1 || close === -1) throw new Error('Invalid CAST expression');
  const inner = input.slice(open + 1, close).trim();
  if (inner.toUpperCase() === 'NULL') return { value: null, next: close + 1 };
  const parsed = parseSqlStringLiteral(inner, inner.startsWith('N') ? 0 : 0);
  return { value: parsed.value, next: close + 1 };
}

function tokenizeValues(valuesInner: string): (string | null)[] {
  const tokens: (string | null)[] = [];
  let i = 0;
  const s = valuesInner.trim();

  while (i < s.length) {
    while (i < s.length && (s[i] === ',' || /\s/.test(s[i]))) i += 1;
    if (i >= s.length) break;

    if (s.slice(i, i + 4).toUpperCase() === 'NULL') {
      tokens.push(null);
      i += 4;
      continue;
    }

    if (s.slice(i, i + 5).toUpperCase() === 'CAST(') {
      const parsed = parseCastDateTime(s, i);
      tokens.push(parsed.value);
      i = parsed.next;
      continue;
    }

    if (s[i] === 'N' && s[i + 1] === "'") {
      const parsed = parseSqlStringLiteral(s, i);
      tokens.push(parsed.value);
      i = parsed.next;
      continue;
    }

    const numMatch = s.slice(i).match(/^\d+/);
    if (numMatch) {
      tokens.push(numMatch[0]);
      i += numMatch[0].length;
      continue;
    }

    throw new Error(`Unexpected token near: ${s.slice(i, i + 60)}`);
  }

  return tokens;
}

function extractUserBlocks(sql: string): string[] {
  const blocks: string[] = [];
  const lines = sql.split(/\r?\n/);
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('INSERT [dbo].[TabCorporateUser]')) {
      if (current.length) blocks.push(current.join('\n'));
      current = [line];
      continue;
    }
    if (current.length) {
      current.push(line);
      if (line.trim() === 'GO') {
        blocks.push(current.join('\n'));
        current = [];
      }
    }
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

function parseLegacyBank(line: string): LegacyBank | null {
  const valuesIdx = line.indexOf('VALUES');
  if (valuesIdx === -1) return null;
  const open = line.indexOf('(', valuesIdx);
  const close = line.lastIndexOf(')');
  if (open === -1 || close === -1) return null;
  try {
    const tokens = tokenizeValues(line.slice(open + 1, close));
    if (tokens.length < 2) return null;
    return {
      legacyId: Number(tokens[0]),
      name: (tokens[1] || '').trim(),
    };
  } catch {
    return null;
  }
}

function parseLegacyBankUser(block: string): LegacyBankUser | null {
  const valuesIdx = block.indexOf('VALUES');
  if (valuesIdx === -1) return null;
  const open = block.indexOf('(', valuesIdx);
  const close = block.lastIndexOf(')');
  if (open === -1 || close === -1 || close <= open) return null;

  try {
    const tokens = tokenizeValues(block.slice(open + 1, close));
    if (tokens.length < 16) return null;

    const companyType = (tokens[13] || '').trim();
    if (companyType.toLowerCase() !== 'bank') return null;

    return {
      legacyId: Number(tokens[0]),
      name: (tokens[1] || '').trim(),
      email: (tokens[2] || '').trim(),
      password: tokens[5] || '',
      bankId: tokens[14] === null ? null : Number(tokens[14]),
      createdAt: tokens[6],
      modifiedAt: tokens[8],
    };
  } catch {
    return null;
  }
}

function uniquifyEmail(email: string, legacyId: number): string {
  const trimmed = email.trim();
  if (!trimmed) return `bank-${legacyId}@migrated.uasa.local`;
  const at = trimmed.indexOf('@');
  if (at === -1) return `${trimmed}+${legacyId}@migrated.uasa.local`;
  return `${trimmed.slice(0, at)}+${legacyId}@${trimmed.slice(at + 1)}`;
}

function resolveEmails(users: LegacyBankUser[]): Map<number, string> {
  const resolved = new Map<number, string>();
  const emailOwner = new Map<string, number>();

  for (const user of [...users].sort((a, b) => a.legacyId - b.legacyId)) {
    const base = user.email.toLowerCase() || `bank-${user.legacyId}@migrated.uasa.local`;
    const owner = emailOwner.get(base);
    const finalEmail =
      owner === undefined ? user.email || uniquifyEmail('', user.legacyId) : uniquifyEmail(user.email, user.legacyId);
    resolved.set(user.legacyId, finalEmail);
    if (owner === undefined) emailOwner.set(base, user.legacyId);
  }
  return resolved;
}

export async function importBankUsers(options: { dryRun?: boolean } = {}): Promise<ImportSummary> {
  const dryRun = options.dryRun ?? false;
  const sql = fs.readFileSync(SQL_PATH, 'utf-8');

  const banks: LegacyBank[] = [];
  for (const line of sql.split(/\r?\n/)) {
    if (!line.startsWith('INSERT [dbo].[TabBanks]')) continue;
    const bank = parseLegacyBank(line);
    if (bank) banks.push(bank);
  }

  const users: LegacyBankUser[] = [];
  const errors: ImportSummary['errors'] = [];
  for (const block of extractUserBlocks(sql)) {
    const user = parseLegacyBankUser(block);
    if (!user) {
      if (block.includes("N'Bank',")) {
        const idMatch = block.match(/VALUES\s*\((\d+)/);
        errors.push({
          legacyId: idMatch ? Number(idMatch[1]) : -1,
          email: '',
          error: 'Failed to parse bank user INSERT block',
        });
      }
      continue;
    }
    users.push(user);
  }

  const summary: ImportSummary = {
    dryRun,
    banksParsed: banks.length,
    banksImported: 0,
    banksUpdated: 0,
    usersParsed: users.length,
    usersImported: 0,
    usersUpdated: 0,
    usersSkipped: 0,
    errors: [...errors],
  };

  if (dryRun) return summary;

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  try {
    let maxBankId = 0;
    const bankIdMap = new Map<number, number>();

    for (const bank of banks.sort((a, b) => a.legacyId - b.legacyId)) {
      maxBankId = Math.max(maxBankId, bank.legacyId);

      const [byId] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT id FROM banks WHERE id = ? LIMIT 1',
        [bank.legacyId]
      );

      if (byId.length > 0) {
        const [nameConflict] = await connection.query<mysql.RowDataPacket[]>(
          'SELECT id FROM banks WHERE name = ? AND id != ? LIMIT 1',
          [bank.name, bank.legacyId]
        );
        if (nameConflict.length === 0) {
          await connection.execute('UPDATE banks SET name = ?, is_active = 1 WHERE id = ?', [
            bank.name.slice(0, 255),
            bank.legacyId,
          ]);
        } else {
          await connection.execute('UPDATE banks SET is_active = 1 WHERE id = ?', [bank.legacyId]);
        }
        bankIdMap.set(bank.legacyId, bank.legacyId);
        summary.banksUpdated += 1;
        continue;
      }

      const [byName] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT id FROM banks WHERE name = ? LIMIT 1',
        [bank.name]
      );

      if (byName.length > 0) {
        bankIdMap.set(bank.legacyId, Number(byName[0].id));
        await connection.execute('UPDATE banks SET is_active = 1 WHERE id = ?', [byName[0].id]);
        summary.banksUpdated += 1;
        continue;
      }

      try {
        await connection.execute('INSERT INTO banks (id, name, auto_invoice, is_active) VALUES (?, ?, 1, 1)', [
          bank.legacyId,
          bank.name.slice(0, 255),
        ]);
        bankIdMap.set(bank.legacyId, bank.legacyId);
        summary.banksImported += 1;
      } catch (err) {
        const [fallback] = await connection.query<mysql.RowDataPacket[]>(
          'SELECT id FROM banks WHERE name = ? LIMIT 1',
          [bank.name]
        );
        if (fallback.length > 0) {
          bankIdMap.set(bank.legacyId, Number(fallback[0].id));
          summary.banksUpdated += 1;
        } else {
          throw err;
        }
      }
    }

    if (maxBankId > 0) {
      await connection.query(`ALTER TABLE banks AUTO_INCREMENT = ${maxBankId + 1}`);
    }

    const emailByLegacyId = resolveEmails(users);
    let maxUserId = 0;
    const total = users.length;
    let processed = 0;

    for (const user of users.sort((a, b) => a.legacyId - b.legacyId)) {
      processed += 1;
      if (processed % 100 === 0 || processed === total) {
        console.log(`Importing bank users ${processed}/${total}...`);
      }

      let email = emailByLegacyId.get(user.legacyId)!;
      const name = user.name || email;
      const resolvedBankId =
        user.bankId == null ? null : (bankIdMap.get(user.bankId) ?? user.bankId);
      const plainPassword = user.password.trim() || `ChangeMe@${user.legacyId}`;
      const passwordHash = await bcrypt.hash(plainPassword, 10);
      const mustChange = user.password.trim() ? 0 : 1;
      maxUserId = Math.max(maxUserId, user.legacyId);

      try {
        const [emailTaken] = await connection.query<mysql.RowDataPacket[]>(
          'SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1',
          [email, user.legacyId]
        );
        if (emailTaken.length > 0) {
          email = uniquifyEmail(user.email, user.legacyId);
        }

        const [existing] = await connection.query<mysql.RowDataPacket[]>(
          'SELECT id, email FROM users WHERE id = ? LIMIT 1',
          [user.legacyId]
        );

        if (existing.length > 0) {
          await connection.execute(
            `UPDATE users
             SET email = ?, password_hash = ?, name = ?, company = NULL, bank_id = ?, role = 'bank',
                 is_active = 1, must_change_password = ?, created_at = COALESCE(?, created_at),
                 updated_at = COALESCE(?, updated_at)
             WHERE id = ?`,
            [email, passwordHash, name.slice(0, 255), resolvedBankId, mustChange, user.createdAt, user.modifiedAt, user.legacyId]
          );
          summary.usersUpdated += 1;
        } else {
          await connection.execute(
            `INSERT INTO users
              (id, email, password_hash, name, company, bank_id, role, is_active, must_change_password, created_at, updated_at)
             VALUES (?, ?, ?, ?, NULL, ?, 'bank', 1, ?, ?, ?)`,
            [user.legacyId, email, passwordHash, name.slice(0, 255), resolvedBankId, mustChange, user.createdAt, user.modifiedAt]
          );
          summary.usersImported += 1;
        }
      } catch (err) {
        summary.usersSkipped += 1;
        summary.errors.push({
          legacyId: user.legacyId,
          email,
          error: err instanceof Error ? err.message : 'Insert failed',
        });
      }
    }

    if (maxUserId > 0) {
      const [maxRow] = await connection.query<mysql.RowDataPacket[]>('SELECT MAX(id) AS maxId FROM users');
      const currentMax = Number(maxRow[0]?.maxId || 0);
      await connection.query(`ALTER TABLE users AUTO_INCREMENT = ${Math.max(maxUserId, currentMax) + 1}`);
    }
  } finally {
    await connection.end();
  }

  return summary;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const summary = await importBankUsers({ dryRun });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length > 0 && !dryRun) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
