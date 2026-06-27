import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.resolve(__dirname, '../../../docs/migrated-data/corporate-users-bank.sql');

type LegacyParticipant = {
  legacyId: number;
  corporateUserId: number;
  fullName: string;
  email: string;
  mobile: string;
  createdBy: string;
  createdAt: string | null;
  modifiedBy: string | null;
  modifiedAt: string | null;
  personId: string;
  jobPosition: string;
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

function extractParticipantBlocks(sql: string): string[] {
  const blocks: string[] = [];
  const lines = sql.split(/\r?\n/);
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('INSERT [dbo].[TabCorporateParticipants]')) {
      if (current.length) blocks.push(current.join('\n'));
      current = [line];
    } else if (current.length) {
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

function parseLegacyParticipant(block: string): LegacyParticipant | null {
  const valuesIdx = block.indexOf('VALUES');
  if (valuesIdx === -1) return null;

  const open = block.indexOf('(', valuesIdx);
  const close = block.lastIndexOf(')');
  if (open === -1 || close === -1 || close <= open) return null;

  try {
    const tokens = tokenizeValues(block.slice(open + 1, close));
    if (tokens.length < 11) return null;

    return {
      legacyId: Number(tokens[0]),
      corporateUserId: Number(tokens[1]),
      fullName: (tokens[2] || '').trim(),
      email: (tokens[3] || '').trim(),
      mobile: (tokens[4] || '').trim(),
      createdBy: (tokens[5] || '').trim(),
      createdAt: tokens[6],
      modifiedBy: tokens[7],
      modifiedAt: tokens[8],
      personId: (tokens[9] || '').trim(),
      jobPosition: (tokens[10] || '').trim(),
    };
  } catch {
    return null;
  }
}

export async function importBankParticipants(options: { dryRun?: boolean } = {}): Promise<ImportSummary> {
  const dryRun = options.dryRun ?? false;
  const sql = fs.readFileSync(SQL_PATH, 'utf-8');
  const blocks = extractParticipantBlocks(sql);

  const parsed: LegacyParticipant[] = [];
  const summary: ImportSummary = {
    dryRun,
    parsed: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const block of blocks) {
    const row = parseLegacyParticipant(block);
    if (!row) {
      const idMatch = block.match(/VALUES\s*\((\d+)/);
      summary.errors.push({
        legacyId: idMatch ? Number(idMatch[1]) : -1,
        email: '',
        error: 'Failed to parse INSERT block',
      });
      continue;
    }
    parsed.push(row);
  }

  summary.parsed = parsed.length;
  if (dryRun || parsed.length === 0) return summary;

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  try {
    const [userRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE role = 'bank'"
    );
    const validUserIds = new Set(userRows.map((r) => Number(r.id)));

    let maxId = 0;
    const total = parsed.length;
    let processed = 0;

    for (const row of parsed.sort((a, b) => a.legacyId - b.legacyId)) {
      processed += 1;
      if (processed % 10 === 0 || processed === total) {
        console.log(`Importing bank participants ${processed}/${total}...`);
      }

      if (!row.fullName || !row.email) {
        summary.skipped += 1;
        summary.errors.push({
          legacyId: row.legacyId,
          email: row.email,
          error: 'Missing full name or email',
        });
        continue;
      }

      if (!validUserIds.has(row.corporateUserId)) {
        summary.skipped += 1;
        summary.errors.push({
          legacyId: row.legacyId,
          email: row.email,
          error: `Bank user ${row.corporateUserId} not found`,
        });
        continue;
      }

      maxId = Math.max(maxId, row.legacyId);

      try {
        const phone = row.mobile || null;
        const personId = row.personId || null;
        const jobPosition = row.jobPosition || null;

        const [existingById] = await connection.query<mysql.RowDataPacket[]>(
          'SELECT id, user_id FROM participants WHERE id = ? LIMIT 1',
          [row.legacyId]
        );

        if (existingById.length > 0) {
          await connection.execute(
            `UPDATE participants
             SET user_id = ?, workshop_id = NULL, full_name = ?, email = ?, phone = ?,
                 person_id = ?, job_position = ?, status = 'confirmed',
                 created_at = COALESCE(?, created_at)
             WHERE id = ?`,
            [
              row.corporateUserId,
              row.fullName.slice(0, 255),
              row.email.slice(0, 255),
              phone ? phone.slice(0, 50) : null,
              personId ? personId.slice(0, 100) : null,
              jobPosition ? jobPosition.slice(0, 255) : null,
              row.createdAt,
              row.legacyId,
            ]
          );
          summary.updated += 1;
          continue;
        }

        const [existingRoster] = await connection.query<mysql.RowDataPacket[]>(
          'SELECT id FROM participants WHERE user_id = ? AND workshop_id IS NULL AND email = ? LIMIT 1',
          [row.corporateUserId, row.email]
        );

        if (existingRoster.length > 0) {
          await connection.execute(
            `UPDATE participants
             SET full_name = ?, phone = ?, person_id = ?, job_position = ?, status = 'confirmed',
                 created_at = COALESCE(?, created_at)
             WHERE id = ?`,
            [
              row.fullName.slice(0, 255),
              phone ? phone.slice(0, 50) : null,
              personId ? personId.slice(0, 100) : null,
              jobPosition ? jobPosition.slice(0, 255) : null,
              row.createdAt,
              existingRoster[0].id,
            ]
          );
          summary.updated += 1;
          continue;
        }

        await connection.execute(
          `INSERT INTO participants
            (id, user_id, workshop_id, full_name, email, phone, person_id, job_position, status, created_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          [
            row.legacyId,
            row.corporateUserId,
            row.fullName.slice(0, 255),
            row.email.slice(0, 255),
            phone ? phone.slice(0, 50) : null,
            personId ? personId.slice(0, 100) : null,
            jobPosition ? jobPosition.slice(0, 255) : null,
            row.createdAt,
          ]
        );
        summary.imported += 1;
      } catch (err) {
        summary.skipped += 1;
        summary.errors.push({
          legacyId: row.legacyId,
          email: row.email,
          error: err instanceof Error ? err.message : 'Insert failed',
        });
      }
    }

    const [maxRow] = await connection.query<mysql.RowDataPacket[]>('SELECT MAX(id) AS maxId FROM participants');
    const currentMax = Math.max(maxId, Number(maxRow[0]?.maxId || 0));
    if (currentMax > 0) {
      await connection.query(`ALTER TABLE participants AUTO_INCREMENT = ${currentMax + 1}`);
    }
  } finally {
    await connection.end();
  }

  return summary;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const summary = await importBankParticipants({ dryRun });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length > 0 && !dryRun) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
