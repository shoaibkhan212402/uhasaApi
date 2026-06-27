import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.resolve(__dirname, '../../../docs/migrated-data/corporate-users-corporate-only.sql');

type LegacyCorporateUser = {
  legacyId: number;
  name: string;
  email: string;
  password: string;
  companyName: string;
  bankId: number | null;
  companyType: string;
  createdAt: string | null;
  modifiedAt: string | null;
};

type ImportSummary = {
  dryRun: boolean;
  parsed: number;
  imported: number;
  updated: number;
  skipped: number;
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

function extractInsertBlocks(sql: string): string[] {
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

function parseLegacyUser(block: string): LegacyCorporateUser | null {
  const valuesIdx = block.indexOf('VALUES');
  if (valuesIdx === -1) return null;

  const open = block.indexOf('(', valuesIdx);
  const close = block.lastIndexOf(')');
  if (open === -1 || close === -1 || close <= open) return null;

  try {
    const tokens = tokenizeValues(block.slice(open + 1, close));
    if (tokens.length < 16) return null;

    const [
      legacyIdRaw,
      name,
      email,
      _mobile,
      _userName,
      password,
      _createdBy,
      createdAt,
      _modifiedBy,
      modifiedAt,
      companyName,
      _companyAddress,
      _companyTrn,
      companyType,
      bankIdRaw,
    ] = tokens;

    return {
      legacyId: Number(legacyIdRaw),
      name: (name || '').trim(),
      email: (email || '').trim(),
      password: password || '',
      companyName: (companyName || '').trim(),
      bankId: bankIdRaw === null ? null : Number(bankIdRaw),
      companyType: (companyType || 'Corporate').trim(),
      createdAt,
      modifiedAt,
    };
  } catch {
    return null;
  }
}

function mapRole(companyType: string): 'corporate' | 'cto' {
  if (companyType.toUpperCase() === 'HCT') return 'cto';
  return 'corporate';
}

function uniquifyEmail(email: string, legacyId: number): string {
  const trimmed = email.trim();
  if (!trimmed) return `corporate-${legacyId}@migrated.uasa.local`;
  const at = trimmed.indexOf('@');
  if (at === -1) return `${trimmed}+${legacyId}@migrated.uasa.local`;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local}+${legacyId}@${domain}`;
}

function resolveEmails(users: LegacyCorporateUser[]): Map<number, string> {
  const resolved = new Map<number, string>();
  const emailOwner = new Map<string, number>();

  const sorted = [...users].sort((a, b) => a.legacyId - b.legacyId);
  for (const user of sorted) {
    const base = user.email.toLowerCase() || `corporate-${user.legacyId}@migrated.uasa.local`;
    const owner = emailOwner.get(base);
    const finalEmail = owner === undefined ? (user.email || uniquifyEmail('', user.legacyId)) : uniquifyEmail(user.email, user.legacyId);
    resolved.set(user.legacyId, finalEmail);
    if (owner === undefined) emailOwner.set(base, user.legacyId);
  }
  return resolved;
}

export async function importCorporateUsers(options: { dryRun?: boolean } = {}): Promise<ImportSummary> {
  const dryRun = options.dryRun ?? false;
  const sql = fs.readFileSync(SQL_PATH, 'utf-8');
  const blocks = extractInsertBlocks(sql);

  const parsedUsers: LegacyCorporateUser[] = [];
  const parseErrors: ImportSummary['errors'] = [];

  for (const block of blocks) {
    const user = parseLegacyUser(block);
    if (!user) {
      const idMatch = block.match(/VALUES\s*\((\d+)/);
      parseErrors.push({
        legacyId: idMatch ? Number(idMatch[1]) : -1,
        email: '',
        error: 'Failed to parse INSERT block',
      });
      continue;
    }
    parsedUsers.push(user);
  }

  const emailByLegacyId = resolveEmails(parsedUsers);
  const summary: ImportSummary = {
    dryRun,
    parsed: parsedUsers.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [...parseErrors],
  };

  if (dryRun || parsedUsers.length === 0) {
    return summary;
  }

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  try {
    let maxId = 0;
    const total = parsedUsers.length;
    let processed = 0;

    for (const user of parsedUsers.sort((a, b) => a.legacyId - b.legacyId)) {
      processed += 1;
      if (processed % 50 === 0 || processed === total) {
        console.log(`Importing ${processed}/${total}...`);
      }
      const email = emailByLegacyId.get(user.legacyId)!;
      const role = mapRole(user.companyType);
      const company = user.companyName || user.name || null;
      const name = user.name || user.companyName || email;
      const plainPassword = user.password.trim() || `ChangeMe@${user.legacyId}`;
      const passwordHash = await bcrypt.hash(plainPassword, 10);
      const mustChange = user.password.trim() ? 0 : 1;
      maxId = Math.max(maxId, user.legacyId);

      try {
        const [existing] = await connection.query<mysql.RowDataPacket[]>(
          'SELECT id, email FROM users WHERE id = ? OR email = ? LIMIT 1',
          [user.legacyId, email]
        );

        if (existing.length > 0 && existing[0].id !== user.legacyId) {
          summary.skipped += 1;
          summary.errors.push({
            legacyId: user.legacyId,
            email,
            error: `Email already used by user id ${existing[0].id}`,
          });
          continue;
        }

        if (existing.length > 0) {
          await connection.execute(
            `UPDATE users
             SET email = ?, password_hash = ?, name = ?, company = ?, bank_id = ?, role = ?,
                 is_active = 1, must_change_password = ?, created_at = COALESCE(?, created_at),
                 updated_at = COALESCE(?, updated_at)
             WHERE id = ?`,
            [
              email,
              passwordHash,
              name.slice(0, 255),
              company ? company.slice(0, 255) : null,
              user.bankId,
              role,
              mustChange,
              user.createdAt,
              user.modifiedAt,
              user.legacyId,
            ]
          );
          summary.updated += 1;
        } else {
          await connection.execute(
            `INSERT INTO users
              (id, email, password_hash, name, company, bank_id, role, is_active, must_change_password, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
            [
              user.legacyId,
              email,
              passwordHash,
              name.slice(0, 255),
              company ? company.slice(0, 255) : null,
              user.bankId,
              role,
              mustChange,
              user.createdAt,
              user.modifiedAt,
            ]
          );
          summary.imported += 1;
        }
      } catch (err) {
        summary.skipped += 1;
        summary.errors.push({
          legacyId: user.legacyId,
          email,
          error: err instanceof Error ? err.message : 'Insert failed',
        });
      }
    }

    if (maxId > 0) {
      await connection.query(`ALTER TABLE users AUTO_INCREMENT = ${maxId + 1}`);
    }
  } finally {
    await connection.end();
  }

  return summary;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const summary = await importCorporateUsers({ dryRun });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length > 0 && !dryRun) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
