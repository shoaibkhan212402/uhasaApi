import { query, pool } from '../db/pool.js';

const email = process.argv[2] || 'amir@fugentex.com';

async function main() {
  const emails = await query(
    `SELECT id, recipient, subject, template_type, status, sent_at
     FROM email_log
     WHERE recipient = ?
     ORDER BY sent_at DESC LIMIT 5`,
    [email]
  );

  const invoices = await query(
    `SELECT i.id, i.invoice_number, i.total_amount, p.full_name, p.email
     FROM invoices i
     JOIN participants p ON p.id = i.participant_id
     WHERE p.email = ?
     ORDER BY i.created_at DESC`,
    [email]
  );

  console.log('Email log:', emails);
  console.log('Invoices:', invoices);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
