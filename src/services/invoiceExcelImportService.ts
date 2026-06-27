import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import mysql from 'mysql2/promise';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(__dirname, '../../../frontend/src/Invoices.xlsx');
const LEGACY_INVOICE_USER_EMAIL = 'legacy-invoices@uasatraining.internal';
const VAT_RATE = 0.05;

export interface InvoiceExcelRow {
  serialNo: number;
  invoiceNo: string;
  orderId: number;
  type: 'Automatic' | 'Manual';
  userType: 'Individual' | 'Corporate' | 'Bank';
}

export function parseInvoicesExcel(filePath: string = DEFAULT_FILE): InvoiceExcelRow[] {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { defval: '', header: 1 });
  const headerIdx = raw.findIndex(
    (row) => Array.isArray(row) && String(row[1] ?? '').trim().toLowerCase() === 'invoiceno'
  );
  if (headerIdx < 0) {
    throw new Error(`Could not find header row in ${filePath}`);
  }

  const rows: InvoiceExcelRow[] = [];
  for (const row of raw.slice(headerIdx + 1)) {
    if (!Array.isArray(row)) continue;
    const invoiceNo = String(row[1] ?? '').trim();
    const orderId = Number(row[2]);
    const type = String(row[3] ?? '').trim();
    const userType = String(row[4] ?? '').trim();
    if (!invoiceNo || !Number.isFinite(orderId) || orderId <= 0) continue;

    rows.push({
      serialNo: Number(row[0]) || rows.length + 1,
      invoiceNo,
      orderId,
      type: type.toLowerCase() === 'manual' ? 'Manual' : 'Automatic',
      userType:
        userType.toLowerCase() === 'bank'
          ? 'Bank'
          : userType.toLowerCase() === 'corporate'
            ? 'Corporate'
            : 'Individual',
    });
  }

  return rows;
}

function splitAmounts(totalAmount: number | null): {
  amount: number;
  vatAmount: number;
  totalAmount: number;
} {
  const total = Number(totalAmount ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    return { amount: 0, vatAmount: 0, totalAmount: 0 };
  }
  const amount = Math.round((total / (1 + VAT_RATE)) * 100) / 100;
  const vatAmount = Math.round((total - amount) * 100) / 100;
  return { amount, vatAmount, totalAmount: total };
}

function mapRegistrationStatus(status: string | null | undefined): 'draft' | 'sent' | 'paid' | 'cancelled' {
  if (status === 'confirmed') return 'paid';
  if (status === 'cancelled') return 'cancelled';
  return 'sent';
}

async function ensureSchema(conn: mysql.Connection): Promise<void> {
  const db = config.db.database;

  const [invoiceTypeCol] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'registrations' AND COLUMN_NAME = 'invoice_type'`,
    [db]
  );
  if (invoiceTypeCol.length === 0) {
    await conn.query(`ALTER TABLE registrations ADD COLUMN invoice_type VARCHAR(20) NULL AFTER invoice_number`);
  }

  const [registrationIdCol] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'registration_id'`,
    [db]
  );
  if (registrationIdCol.length === 0) {
    await conn.query(`ALTER TABLE invoices ADD COLUMN registration_id INT NULL AFTER participant_id`);
    await conn.query(`ALTER TABLE invoices ADD INDEX idx_invoices_registration (registration_id)`);
    try {
      await conn.query(
        `ALTER TABLE invoices ADD CONSTRAINT fk_invoices_registration
         FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE`
      );
    } catch {
      // Constraint may already exist under a different name.
    }
  }

  const [participantCol] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'participant_id'`,
    [db]
  );
  if (participantCol[0]?.IS_NULLABLE === 'NO') {
    await conn.query(`ALTER TABLE invoices MODIFY participant_id INT NULL`);
  }

  const [workshopCol] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'workshop_id'`,
    [db]
  );
  if (workshopCol[0]?.IS_NULLABLE === 'NO') {
    await conn.query(`ALTER TABLE invoices MODIFY workshop_id INT NULL`);
  }
}

async function ensureLegacyInvoiceUser(conn: mysql.Connection): Promise<number> {
  const [existing] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [LEGACY_INVOICE_USER_EMAIL]
  );
  if (existing[0]?.id) return existing[0].id as number;

  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  const [result] = await conn.query<mysql.ResultSetHeader>(
    `INSERT INTO users (email, password_hash, name, company, role, is_active)
     VALUES (?, ?, 'Legacy Invoices', 'Legacy Import', 'corporate', 0)`,
    [LEGACY_INVOICE_USER_EMAIL, passwordHash]
  );
  return result.insertId;
}

export async function importInvoicesExcel(options?: {
  filePath?: string;
  dryRun?: boolean;
}) {
  const filePath = options?.filePath ?? DEFAULT_FILE;
  const dryRun = options?.dryRun ?? false;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const rows = parseInvoicesExcel(filePath);
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectTimeout: 20000,
  });

  if (!dryRun) {
    await ensureSchema(conn);
  }

  const summary = {
    parsed: rows.length,
    registrationsUpdated: 0,
    invoicesInserted: 0,
    invoicesUpdated: 0,
    skippedNoRegistration: 0,
    failed: [] as string[],
    dryRun,
  };

  const legacyUserId = dryRun ? 0 : await ensureLegacyInvoiceUser(conn);

  for (const row of rows) {
    try {
      const [regRows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT id, workshop_id, registration_type, status, total_amount, invoice_number
         FROM registrations WHERE id = ?`,
        [row.orderId]
      );
      const registration = regRows[0];
      if (!registration) {
        summary.skippedNoRegistration++;
        continue;
      }

      const amounts = splitAmounts(
        registration.total_amount == null ? null : Number(registration.total_amount)
      );
      const invoiceStatus = mapRegistrationStatus(registration.status as string);
      const sentAt = row.type === 'Automatic' ? new Date() : null;

      const [participantRows] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT id FROM participants WHERE id = ?',
        [row.orderId]
      );
      const participantId = (participantRows[0]?.id as number | undefined) ?? null;

      if (dryRun) {
        summary.registrationsUpdated++;
        summary.invoicesInserted++;
        continue;
      }

      await conn.query(
        `UPDATE registrations
         SET invoice_number = ?, invoice_type = ?, registration_type = ?
         WHERE id = ?`,
        [row.invoiceNo, row.type, row.userType, row.orderId]
      );
      summary.registrationsUpdated++;

      const [existingByNumber] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT id FROM invoices WHERE invoice_number = ? LIMIT 1',
        [row.invoiceNo]
      );
      const [existingByRegistration] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT id FROM invoices WHERE registration_id = ? LIMIT 1',
        [row.orderId]
      );
      const existingId =
        (existingByNumber[0]?.id as number | undefined) ??
        (existingByRegistration[0]?.id as number | undefined);

      if (existingId) {
        await conn.query(
          `UPDATE invoices SET
            invoice_number = ?, user_id = ?, workshop_id = ?, participant_id = ?, registration_id = ?,
            amount = ?, vat_amount = ?, total_amount = ?, status = ?, sent_at = ?
           WHERE id = ?`,
          [
            row.invoiceNo,
            legacyUserId,
            registration.workshop_id ?? null,
            participantId,
            row.orderId,
            amounts.amount,
            amounts.vatAmount,
            amounts.totalAmount,
            invoiceStatus,
            sentAt,
            existingId,
          ]
        );
        summary.invoicesUpdated++;
      } else {
        await conn.query(
          `INSERT INTO invoices (
            invoice_number, user_id, workshop_id, participant_id, registration_id,
            amount, vat_amount, total_amount, status, sent_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.invoiceNo,
            legacyUserId,
            registration.workshop_id ?? null,
            participantId,
            row.orderId,
            amounts.amount,
            amounts.vatAmount,
            amounts.totalAmount,
            invoiceStatus,
            sentAt,
          ]
        );
        summary.invoicesInserted++;
      }

      if (participantId) {
        const [invoiceRow] = await conn.query<mysql.RowDataPacket[]>(
          'SELECT id FROM invoices WHERE invoice_number = ? LIMIT 1',
          [row.invoiceNo]
        );
        const invoiceId = invoiceRow[0]?.id as number | undefined;
        if (invoiceId) {
          await conn.query('UPDATE participants SET invoice_id = ? WHERE id = ?', [
            invoiceId,
            participantId,
          ]);
        }
      }
    } catch (err) {
      summary.failed.push(
        `Invoice ${row.invoiceNo} / Order ${row.orderId}: ${
          err instanceof Error ? err.message : 'Import failed'
        }`
      );
    }
  }

  await conn.end();
  return summary;
}

