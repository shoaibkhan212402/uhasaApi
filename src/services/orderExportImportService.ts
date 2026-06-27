import mysql from 'mysql2/promise';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.resolve(__dirname, '../../../frontend/src');

export type OrderExportKind = 'approve' | 'online-paid' | 'corporate' | 'bank';

export interface OrderExportRow {
  orderId: number;
  name: string;
  email: string;
  company: string;
  invoiceNo: string;
  userType: 'Individual' | 'Corporate' | 'Bank';
  contactNo: string;
  totalAmount: number | null;
  totalSeats: number;
  status: 'pending' | 'confirmed' | 'cancelled';
}

export const ORDER_EXPORT_FILES: Record<OrderExportKind, string> = {
  approve: path.join(FRONTEND_SRC, 'approve-orders.xls'),
  'online-paid': path.join(FRONTEND_SRC, 'online-paid-orders.xlsx'),
  corporate: path.join(FRONTEND_SRC, 'corporate-orders.xlsx'),
  bank: path.join(FRONTEND_SRC, 'bank-orders.xlsx'),
};

function findHeaderRowIndex(rows: unknown[][]): number {
  return rows.findIndex(
    (row) => Array.isArray(row) && String(row[0] ?? '').trim().toLowerCase() === 'order id'
  );
}

function cell(row: (string | number)[], index: number): string {
  return String(row[index] ?? '').trim();
}

function parseAmount(value: string | number | null | undefined): number | null {
  if (value === '' || value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseSeats(value: string | number | null | undefined, fallback = 1): number {
  const num = parseInt(String(value ?? ''), 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function normalizeType(value: string, fallback: OrderExportRow['userType']): OrderExportRow['userType'] {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'corporate') return 'Corporate';
  if (normalized === 'bank') return 'Bank';
  if (normalized === 'individual') return 'Individual';
  return fallback;
}

function normalizeStatus(action: string, fallback: OrderExportRow['status']): OrderExportRow['status'] {
  const normalized = action.trim().toLowerCase();
  if (normalized === 'paid' || normalized === 'confirmed') return 'confirmed';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'approve' || normalized === 'pending') return 'pending';
  return fallback;
}

function mapRowByHeaders(
  row: (string | number)[],
  headers: string[],
  kind: OrderExportKind
): OrderExportRow | null {
  const byHeader = Object.fromEntries(headers.map((header, index) => [header, cell(row, index)]));
  const orderId = Number(byHeader['Order Id']);
  const name = byHeader.Name;
  const email = byHeader.Email;

  if (!Number.isFinite(orderId) || orderId <= 0 || !name || !email) return null;

  const defaultType: OrderExportRow['userType'] =
    kind === 'corporate' ? 'Corporate' : kind === 'bank' ? 'Bank' : 'Individual';
  const defaultStatus: OrderExportRow['status'] =
    kind === 'approve' ? 'pending' : 'confirmed';

  return {
    orderId,
    name,
    email,
    company: byHeader['Company Name'] || '',
    invoiceNo: byHeader['Invoice No'] || '',
    userType: normalizeType(byHeader['User Type'] || '', defaultType),
    contactNo: byHeader['Contact No'] || '',
    totalAmount: parseAmount(byHeader['Total Amount']),
    totalSeats: parseSeats(byHeader['No Of Participants']),
    status: normalizeStatus(byHeader.Action || '', defaultStatus),
  };
}

export function parseOrderExportFile(filePath: string, kind: OrderExportKind): OrderExportRow[] {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { defval: '', header: 1 });
  const headerIdx = findHeaderRowIndex(raw);
  if (headerIdx < 0) {
    throw new Error(`Could not find header row in ${filePath}`);
  }

  const headers = raw[headerIdx].map((header) => String(header ?? '').trim());
  const rows: OrderExportRow[] = [];

  for (const row of raw.slice(headerIdx + 1)) {
    if (!Array.isArray(row)) continue;
    const mapped = mapRowByHeaders(row, headers, kind);
    if (mapped) rows.push(mapped);
  }

  return rows;
}

export async function ensureRegistrationImportSchema(conn: mysql.Connection): Promise<void> {
  const [invoiceCol] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'registrations' AND COLUMN_NAME = 'invoice_number'`,
    [config.db.database]
  );
  if (invoiceCol.length === 0) {
    await conn.query(`ALTER TABLE registrations ADD COLUMN invoice_number VARCHAR(50) NULL AFTER total_amount`);
  }

  const [workshopCol] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'registrations' AND COLUMN_NAME = 'workshop_id'`,
    [config.db.database]
  );
  if (workshopCol[0]?.IS_NULLABLE === 'NO') {
    await conn.query(`ALTER TABLE registrations MODIFY workshop_id INT NULL`);
  }
}

export async function upsertOrderExportRows(
  conn: mysql.Connection,
  rows: OrderExportRow[]
): Promise<{ inserted: number; updated: number; failed: string[] }> {
  const result = { inserted: 0, updated: 0, failed: [] as string[] };

  for (const row of rows) {
    try {
      const [existing] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT id FROM registrations WHERE id = ?',
        [row.orderId]
      );

      if (existing.length > 0) {
        await conn.query(
          `UPDATE registrations SET
            registration_type = ?, full_name = ?, email = ?, phone = ?, company = ?,
            total_seats = ?, total_amount = ?, invoice_number = ?, status = ?
           WHERE id = ?`,
          [
            row.userType,
            row.name,
            row.email,
            row.contactNo || null,
            row.company || null,
            row.totalSeats,
            row.totalAmount,
            row.invoiceNo || null,
            row.status,
            row.orderId,
          ]
        );
        result.updated++;
      } else {
        await conn.query(
          `INSERT INTO registrations (
            id, workshop_id, registration_type, full_name, email, phone, company,
            total_seats, terms_accepted, total_amount, invoice_number, status
          ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [
            row.orderId,
            row.userType,
            row.name,
            row.email,
            row.contactNo || null,
            row.company || null,
            row.totalSeats,
            row.totalAmount,
            row.invoiceNo || null,
            row.status,
          ]
        );
        result.inserted++;
      }
    } catch (err) {
      result.failed.push(
        `Order ${row.orderId} (${row.email}): ${err instanceof Error ? err.message : 'Import failed'}`
      );
    }
  }

  return result;
}

async function syncAutoIncrement(conn: mysql.Connection): Promise<void> {
  const [maxRow] = await conn.query<mysql.RowDataPacket[]>('SELECT MAX(id) as maxId FROM registrations');
  const nextId = Math.max(Number(maxRow[0]?.maxId ?? 0), 1) + 1;
  await conn.query(`ALTER TABLE registrations AUTO_INCREMENT = ?`, [nextId]);
}

export async function importOrderExportKind(
  kind: OrderExportKind,
  options?: { filePath?: string; dryRun?: boolean; replace?: boolean }
): Promise<Record<string, unknown>> {
  const filePath = options?.filePath ?? ORDER_EXPORT_FILES[kind];
  const dryRun = options?.dryRun ?? false;
  const replace = options?.replace ?? false;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const rows = parseOrderExportFile(filePath, kind);
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectTimeout: 20000,
  });

  if (!dryRun) {
    await ensureRegistrationImportSchema(conn);
  }

  const summary: Record<string, unknown> = {
    kind,
    filePath,
    parsed: rows.length,
    withInvoice: rows.filter((row) => row.invoiceNo).length,
    dryRun,
    replace,
    deleted: 0,
    inserted: 0,
    updated: 0,
    failed: [] as string[],
  };

  if (!dryRun && replace) {
    const typeFilter =
      kind === 'online-paid'
        ? `registration_type = 'Individual'`
        : kind === 'corporate'
          ? `registration_type = 'Corporate'`
          : kind === 'bank'
            ? `registration_type = 'Bank'`
            : '1=1';
    const [deleteResult] = await conn.query<mysql.ResultSetHeader>(
      `DELETE FROM registrations WHERE ${typeFilter}`
    );
    summary.deleted = deleteResult.affectedRows;
  }

  if (dryRun) {
    summary.inserted = rows.length;
    await conn.end();
    return summary;
  }

  const upsert = await upsertOrderExportRows(conn, rows);
  summary.inserted = upsert.inserted;
  summary.updated = upsert.updated;
  summary.failed = upsert.failed;

  if (upsert.inserted > 0 || upsert.updated > 0) {
    await syncAutoIncrement(conn);
  }

  await conn.end();
  return summary;
}

export async function importAllOrderExports(options?: {
  dryRun?: boolean;
  replaceApprove?: boolean;
}): Promise<Record<string, unknown>> {
  const dryRun = options?.dryRun ?? false;
  const kinds: OrderExportKind[] = ['approve', 'online-paid', 'corporate', 'bank'];
  const results: Record<string, unknown> = { dryRun, imports: {} as Record<string, unknown> };

  for (const kind of kinds) {
    const filePath = ORDER_EXPORT_FILES[kind];
    if (!fs.existsSync(filePath)) {
      (results.imports as Record<string, unknown>)[kind] = { skipped: true, reason: 'file not found', filePath };
      continue;
    }

    (results.imports as Record<string, unknown>)[kind] = await importOrderExportKind(kind, {
      dryRun,
      replace: kind === 'approve' ? (options?.replaceApprove ?? true) : false,
    });
  }

  return results;
}
