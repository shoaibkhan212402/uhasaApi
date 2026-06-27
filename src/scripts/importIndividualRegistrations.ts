import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { fulfillIndividualRegistration } from '../services/individualRegistrationService.js';
import {
  extractInsertLines,
  readLegacySqlDump,
  sqlEscape,
  tokenizeValues,
  valuesInnerFromLine,
} from './legacySqlUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SQL_PATH = path.resolve(__dirname, '../../../docs/UasaWorkshopDatabaseQuery.sql');
const EXPORT_SQL_PATH = path.resolve(__dirname, '../../../docs/migrated-data/individual-registrations.sql');

type LegacyOrder = {
  workshopOrderId: number;
  isPaid: boolean;
  subtotal: number | null;
  createdAt: string | null;
};

type LegacyOrderItem = {
  orderItemId: number;
  workshopOrderId: number;
  workshopId: number;
};

type LegacyParticipant = {
  participantId: number;
  workshopOrderId: number;
  orderItemId: number | null;
  fullName: string;
  email: string;
  mobile: string;
  companyName: string;
  personId: string;
  jobPosition: string;
  createdAt: string | null;
};

type ImportRow = {
  id: number;
  workshopOrderId: number;
  workshopId: number | null;
  legacyWorkshopId: number;
  fullName: string;
  email: string;
  phone: string;
  company: string;
  personId: string;
  jobPosition: string;
  totalAmount: number | null;
  invoiceNumber: string | null;
  status: 'pending' | 'confirmed';
  createdAt: string | null;
};

type ImportSummary = {
  dryRun: boolean;
  exportSql: boolean;
  parsed: number;
  imported: number;
  updated: number;
  skipped: number;
  fulfilled: number;
  workshopMisses: number;
  errors: { id: number; email: string; error: string }[];
};

function parseLegacyOrders(content: string): Map<number, LegacyOrder> {
  const orders = new Map<number, LegacyOrder>();
  const pattern =
    /INSERT \[dbo\]\.\[TabWorkshopOrders\][^\n]*VALUES \((\d+), N'Individual'[^\n]*N'(?:DebitCreditCard|Manual|[^']*)', (\d),/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const workshopOrderId = Number(match[1]);
    const isPaid = match[2] === '1';
    const line = match[0];
    const subtotalMatches = [...line.matchAll(/CAST\(([0-9.]+) AS Decimal/g)];
    const subtotal = subtotalMatches[2] ? Number(subtotalMatches[2][1]) : null;
    const createdMatch = line.match(/CAST\(N'([^']+)' AS DateTime\)/);
    orders.set(workshopOrderId, {
      workshopOrderId,
      isPaid,
      subtotal,
      createdAt: createdMatch?.[1] ?? null,
    });
  }
  return orders;
}

function parseLegacyOrderItems(content: string): LegacyOrderItem[] {
  const items: LegacyOrderItem[] = [];
  for (const line of extractInsertLines(content, 'TabOrderItems')) {
    const inner = valuesInnerFromLine(line);
    if (!inner) continue;
    try {
      const tokens = tokenizeValues(inner);
      if (tokens.length < 3) continue;
      items.push({
        orderItemId: Number(tokens[0]),
        workshopOrderId: Number(tokens[1]),
        workshopId: Number(tokens[2]),
      });
    } catch {
      // skip
    }
  }
  return items;
}

function parseLegacyParticipants(content: string): LegacyParticipant[] {
  const participants: LegacyParticipant[] = [];
  for (const line of extractInsertLines(content, 'TabWorkshopParticipants')) {
    const inner = valuesInnerFromLine(line);
    if (!inner) continue;
    try {
      const tokens = tokenizeValues(inner);
      if (tokens.length < 16) continue;
      participants.push({
        participantId: Number(tokens[0]),
        workshopOrderId: Number(tokens[1]),
        fullName: (tokens[2] || '').trim(),
        email: (tokens[3] || '').trim(),
        mobile: (tokens[4] || '').trim(),
        createdAt: tokens[6],
        companyName: (tokens[10] || '').trim(),
        orderItemId: tokens[14] ? Number(tokens[14]) : null,
        personId: (tokens[15] || '').trim(),
        jobPosition: (tokens[16] || '').trim(),
      });
    } catch {
      // skip
    }
  }
  return participants;
}

function parseLegacyWorkshopNames(content: string): Map<number, string> {
  const workshops = new Map<number, string>();
  for (const line of extractInsertLines(content, 'Workshop')) {
    const match = line.match(/VALUES \((\d+), N'((?:[^']|'')*)'/);
    if (!match) continue;
    workshops.set(Number(match[1]), match[2].replace(/''/g, "'"));
  }
  return workshops;
}

function parseLegacyInvoices(content: string): Map<number, string> {
  const invoices = new Map<number, string>();
  for (const line of extractInsertLines(content, 'TabInvoice')) {
    const inner = valuesInnerFromLine(line);
    if (!inner) continue;
    try {
      const tokens = tokenizeValues(inner);
      if (tokens.length < 3) continue;
      const invoiceNo = (tokens[1] || '').trim();
      const workshopOrderId = Number(tokens[2]);
      if (invoiceNo) invoices.set(workshopOrderId, invoiceNo);
    } catch {
      // skip
    }
  }
  return invoices;
}

function buildImportRows(content: string): ImportRow[] {
  const orders = parseLegacyOrders(content);
  const orderItems = parseLegacyOrderItems(content);
  const participants = parseLegacyParticipants(content);
  const invoices = parseLegacyInvoices(content);

  const participantsByOrderItem = new Map<number, LegacyParticipant>();
  const participantsByOrder = new Map<number, LegacyParticipant[]>();

  for (const p of participants) {
    if (p.orderItemId) participantsByOrderItem.set(p.orderItemId, p);
    const list = participantsByOrder.get(p.workshopOrderId) || [];
    list.push(p);
    participantsByOrder.set(p.workshopOrderId, list);
  }

  const rows: ImportRow[] = [];

  for (const item of orderItems) {
    const order = orders.get(item.workshopOrderId);
    if (!order) continue;

    const participant =
      participantsByOrderItem.get(item.orderItemId) ||
      (participantsByOrder.get(item.workshopOrderId) || [])[0];

    if (!participant?.fullName || !participant.email) continue;

    const itemsInOrder = orderItems.filter((oi) => oi.workshopOrderId === item.workshopOrderId);
    const itemCount = Math.max(itemsInOrder.length, 1);
    const totalAmount =
      order.subtotal != null ? Math.round((order.subtotal / itemCount) * 100) / 100 : null;

    rows.push({
      id: item.orderItemId,
      workshopOrderId: item.workshopOrderId,
      workshopId: null,
      legacyWorkshopId: item.workshopId,
      fullName: participant.fullName,
      email: participant.email,
      phone: participant.mobile,
      company: participant.companyName,
      personId: participant.personId,
      jobPosition: participant.jobPosition,
      totalAmount,
      invoiceNumber: invoices.get(item.workshopOrderId) || null,
      status: order.isPaid ? 'confirmed' : 'pending',
      createdAt: participant.createdAt || order.createdAt,
    });
  }

  rows.sort((a, b) => a.id - b.id);
  return rows;
}

async function resolveAllWorkshopIds(
  connection: mysql.Connection | null,
  legacyIds: number[],
  legacyNames: Map<number, string>
): Promise<Map<number, number | null>> {
  const resolved = new Map<number, number | null>();
  const uniqueIds = [...new Set(legacyIds)];

  if (!connection) {
    for (const legacyId of uniqueIds) resolved.set(legacyId, legacyId);
    return resolved;
  }

  const [allWorkshops] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT id, title FROM workshops'
  );
  const byId = new Map<number, number>();
  const byTitle = new Map<string, number>();
  const byPrefix = new Map<string, number>();

  for (const row of allWorkshops) {
    const id = Number(row.id);
    const title = String(row.title || '').trim();
    byId.set(id, id);
    byTitle.set(title, id);
    byPrefix.set(title.slice(0, 80), id);
  }

  for (const legacyId of uniqueIds) {
    if (byId.has(legacyId)) {
      resolved.set(legacyId, legacyId);
      continue;
    }

    const legacyName = legacyNames.get(legacyId);
    if (!legacyName) {
      resolved.set(legacyId, null);
      continue;
    }

    const trimmed = legacyName.trim();
    resolved.set(
      legacyId,
      byTitle.get(trimmed) ?? byTitle.get(legacyName) ?? byPrefix.get(trimmed.slice(0, 80)) ?? null
    );
  }

  return resolved;
}

function exportMysqlSql(rows: ImportRow[], workshopTitles: Map<number, string>): void {
  const lines: string[] = [
    '-- Migrated individual registrations from UasaWorkshopDatabaseQuery.sql',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Rows: ${rows.length}`,
    'USE uasa_training;',
    '',
  ];

  for (const row of rows) {
    const wsTitle = workshopTitles.get(row.legacyWorkshopId) || `Legacy workshop #${row.legacyWorkshopId}`;
    const createdAt = row.createdAt ? `'${sqlEscape(row.createdAt)}'` : 'CURRENT_TIMESTAMP';
    lines.push(
      `INSERT INTO registrations (id, workshop_id, registration_type, person_id, full_name, username, job_position, email, phone, company, total_seats, terms_accepted, total_amount, invoice_number, status, created_at) VALUES (${row.id}, ${row.workshopId ?? 'NULL'}, 'Individual', ${row.personId ? `'${sqlEscape(row.personId)}'` : 'NULL'}, '${sqlEscape(row.fullName)}', '${row.workshopOrderId}', ${row.jobPosition ? `'${sqlEscape(row.jobPosition)}'` : 'NULL'}, '${sqlEscape(row.email)}', ${row.phone ? `'${sqlEscape(row.phone)}'` : 'NULL'}, ${row.company ? `'${sqlEscape(row.company)}'` : 'NULL'}, 1, 1, ${row.totalAmount ?? 'NULL'}, ${row.invoiceNumber ? `'${sqlEscape(row.invoiceNumber)}'` : 'NULL'}, '${row.status}', ${createdAt}); -- ${sqlEscape(wsTitle)}`
    );
  }

  if (rows.length > 0) {
    const maxId = Math.max(...rows.map((r) => r.id));
    lines.push('', `ALTER TABLE registrations AUTO_INCREMENT = ${maxId + 1};`);
  }

  fs.mkdirSync(path.dirname(EXPORT_SQL_PATH), { recursive: true });
  fs.writeFileSync(EXPORT_SQL_PATH, lines.join('\n'), 'utf-8');
}

export async function importIndividualRegistrations(options: {
  dryRun?: boolean;
  exportSql?: boolean;
  fulfill?: boolean;
  sqlPath?: string;
} = {}): Promise<ImportSummary> {
  const dryRun = options.dryRun ?? false;
  const exportSql = options.exportSql ?? false;
  const fulfill = options.fulfill ?? !dryRun;
  const sqlPath = options.sqlPath ?? DEFAULT_SQL_PATH;

  const content = readLegacySqlDump(sqlPath);
  const legacyNames = parseLegacyWorkshopNames(content);
  const rows = buildImportRows(content);

  const summary: ImportSummary = {
    dryRun,
    exportSql,
    parsed: rows.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    fulfilled: 0,
    workshopMisses: 0,
    errors: [],
  };

  if (rows.length === 0) return summary;

  let connection: mysql.Connection | null = null;
  if (!dryRun || !exportSql) {
    connection = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      connectTimeout: 20000,
    });
  }

  const workshopMap = await resolveAllWorkshopIds(
    connection,
    rows.map((r) => r.legacyWorkshopId),
    legacyNames
  );

  for (const row of rows) {
    row.workshopId = workshopMap.get(row.legacyWorkshopId) ?? null;
    if (!row.workshopId) summary.workshopMisses += 1;
  }

  if (exportSql) {
    exportMysqlSql(rows, legacyNames);
  }

  if (dryRun) {
    summary.imported = rows.length;
    if (connection) await connection.end();
    return summary;
  }

  if (!connection) {
    throw new Error('Database connection required for import');
  }

  try {
    let maxId = 0;
    const confirmedIds: number[] = [];

    for (const row of rows) {
      maxId = Math.max(maxId, row.id);

      if (!row.email || !row.fullName) {
        summary.skipped += 1;
        summary.errors.push({ id: row.id, email: row.email, error: 'Missing name or email' });
        continue;
      }

      try {
        const [existing] = await connection.query<mysql.RowDataPacket[]>(
          'SELECT id FROM registrations WHERE id = ? LIMIT 1',
          [row.id]
        );

        const updateParams = [
          row.workshopId,
          row.personId ? row.personId.slice(0, 100) : null,
          row.fullName.slice(0, 255),
          String(row.workshopOrderId),
          row.jobPosition ? row.jobPosition.slice(0, 255) : null,
          row.email.slice(0, 255),
          row.phone ? row.phone.slice(0, 50) : null,
          row.company ? row.company.slice(0, 255) : null,
          row.totalAmount,
          row.invoiceNumber ? row.invoiceNumber.slice(0, 50) : null,
          row.status,
          row.createdAt,
          row.id,
        ];

        const insertParams = [
          row.id,
          row.workshopId,
          row.personId ? row.personId.slice(0, 100) : null,
          row.fullName.slice(0, 255),
          String(row.workshopOrderId),
          row.jobPosition ? row.jobPosition.slice(0, 255) : null,
          row.email.slice(0, 255),
          row.phone ? row.phone.slice(0, 50) : null,
          row.company ? row.company.slice(0, 255) : null,
          row.totalAmount,
          row.invoiceNumber ? row.invoiceNumber.slice(0, 50) : null,
          row.status,
          row.createdAt,
        ];

        if (existing.length > 0) {
          await connection.execute(
            `UPDATE registrations SET
              workshop_id = ?, registration_type = 'Individual', person_id = ?, full_name = ?,
              username = ?, job_position = ?, email = ?, phone = ?, company = ?,
              total_seats = 1, terms_accepted = 1, total_amount = ?, invoice_number = ?, status = ?,
              created_at = COALESCE(?, created_at)
             WHERE id = ?`,
            updateParams
          );
          summary.updated += 1;
        } else {
          await connection.execute(
            `INSERT INTO registrations (
              id, workshop_id, registration_type, person_id, full_name, username, job_position,
              email, phone, company, total_seats, terms_accepted, total_amount, invoice_number, status, created_at
            ) VALUES (?, ?, 'Individual', ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
            insertParams
          );
          summary.imported += 1;
        }

        if (row.status === 'confirmed' && row.workshopId) {
          confirmedIds.push(row.id);
        }
      } catch (err) {
        summary.skipped += 1;
        summary.errors.push({
          id: row.id,
          email: row.email,
          error: err instanceof Error ? err.message : 'Import failed',
        });
      }
    }

    if (maxId > 0) {
      await connection.query(`ALTER TABLE registrations AUTO_INCREMENT = ?`, [maxId + 1]);
    }

    await connection.end();

    if (fulfill && confirmedIds.length > 0) {
      for (const id of confirmedIds) {
        try {
          await fulfillIndividualRegistration(id);
          summary.fulfilled += 1;
        } catch (err) {
          summary.errors.push({
            id,
            email: '',
            error: `Fulfillment failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    return summary;
  } catch (err) {
    await connection.end();
    throw err;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const exportSql = process.argv.includes('--export-sql');
  const noFulfill = process.argv.includes('--no-fulfill');

  const summary = await importIndividualRegistrations({
    dryRun,
    exportSql: exportSql || dryRun,
    fulfill: !dryRun && !noFulfill,
  });

  console.log(JSON.stringify(summary, null, 2));
  if (exportSql || dryRun) {
    console.log(`\nSQL export: ${EXPORT_SQL_PATH}`);
  }
  if (summary.errors.length > 0 && !dryRun) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
