import { queryOne } from '../db/pool.js';

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
