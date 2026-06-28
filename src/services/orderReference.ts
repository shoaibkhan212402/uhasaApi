import mysql from 'mysql2/promise';
import { pool, queryOne } from '../db/pool.js';

/** Portal order reference — numeric only, e.g. 00042 */
export function formatOrderId(participantId: number): string {
  return String(participantId).padStart(5, '0');
}

/** Tax invoice number — sequence-year, e.g. 0001-2025 */
export async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM invoices WHERE YEAR(created_at) = ?`,
    [year]
  );
  const seq = ((row?.count || 0) + 1).toString().padStart(4, '0');
  return `${seq}-${year}`;
}

/**
 * Non-locking preview: returns what the next invoice number *would* be.
 * Not guaranteed to still be available at submission time.
 */
export async function peekNextInvoiceNumber(): Promise<{ next_number: string; seq: number }> {
  const year = new Date().getFullYear();
  // Extract the numeric prefix from existing invoice_number strings like "0021-2026"
  const row = await queryOne<{ max_seq: number | null }>(
    `SELECT MAX(CAST(SUBSTRING_INDEX(invoice_number, '-', 1) AS UNSIGNED)) AS max_seq
     FROM invoices
     WHERE YEAR(created_at) = ? AND invoice_number REGEXP '^[0-9]+-[0-9]+$'`,
    [year]
  );
  const nextSeq = (row?.max_seq || 0) + 1;
  return {
    next_number: `${String(nextSeq).padStart(4, '0')}-${year}`,
    seq: nextSeq,
  };
}

/**
 * Atomically reserves `count` sequential invoice numbers inside the provided
 * transaction connection. Uses FOR UPDATE to block concurrent reservations.
 *
 * Returns an array of invoice number strings in order, e.g. ["0021-2026","0022-2026","0023-2026"]
 */
export async function reserveInvoiceNumbers(
  count: number,
  conn: mysql.PoolConnection
): Promise<string[]> {
  const year = new Date().getFullYear();

  // Lock the max row so no concurrent transaction can read/write it simultaneously
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT MAX(CAST(SUBSTRING_INDEX(invoice_number, '-', 1) AS UNSIGNED)) AS max_seq
     FROM invoices
     WHERE YEAR(created_at) = ? AND invoice_number REGEXP '^[0-9]+-[0-9]+$'
     FOR UPDATE`,
    [year]
  );

  const maxSeq: number = (rows[0]?.max_seq as number | null) || 0;

  const numbers: string[] = [];
  for (let i = 1; i <= count; i++) {
    numbers.push(`${String(maxSeq + i).padStart(4, '0')}-${year}`);
  }

  return numbers;
}

/** Get a pool connection for use in manual transactions */
export { pool };
