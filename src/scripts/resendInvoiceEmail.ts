import { query, pool, queryOne } from '../db/pool.js';
import { resendInvoiceEmail } from '../services/invoiceService.js';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx tsx src/scripts/resendInvoiceEmail.ts <participant-email|invoice-number>');
    process.exit(1);
  }

  let invoices: { id: number; invoice_number: string }[];

  if (arg.includes('-')) {
    const row = await queryOne<{ id: number; invoice_number: string }>(
      `SELECT id, invoice_number FROM invoices WHERE invoice_number = ?`,
      [arg]
    );
    invoices = row ? [row] : [];
  } else {
    invoices = await query<{ id: number; invoice_number: string }>(
      `SELECT i.id, i.invoice_number
       FROM invoices i
       JOIN participants p ON p.id = i.participant_id
       WHERE p.email = ?
       ORDER BY i.created_at DESC`,
      [arg]
    );
  }

  if (invoices.length === 0) {
    console.error(`No invoices found for ${arg}`);
    process.exit(1);
  }

  for (const invoice of invoices) {
    await resendInvoiceEmail(invoice.id);
    console.log(`✓ Resent ${invoice.invoice_number} (PDF attachment)`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
