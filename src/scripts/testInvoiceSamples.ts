import bcrypt from 'bcryptjs';
import { insert, query, queryOne, pool } from '../db/pool.js';

const SAMPLE_INVOICES = [
  { id: 1253, orderId: 188, type: 'Automatic', userType: 'Individual', invoiceNo: '' },
  { id: 1256, orderId: 187, type: 'Automatic', userType: 'Individual', invoiceNo: '' },
  { id: 1267, orderId: 180, type: 'Manual', userType: 'Bank', invoiceNo: '' },
  { id: 1272, orderId: 178, type: 'Automatic', userType: 'Corporate', invoiceNo: '' },
] as const;

async function ensureSampleData() {
  const workshop = await queryOne<{ id: number }>(
    `SELECT id FROM workshops WHERE is_published = 1 ORDER BY id LIMIT 1`
  );
  if (!workshop) throw new Error('No workshop found — run db:seed first');

  const hash = await bcrypt.hash('Demo@123', 10);

  async function ensureUser(
    email: string,
    role: 'corporate' | 'bank',
    bankId: number | null,
    autoInvoice: boolean | null
  ) {
    let user = await queryOne<{ id: number }>(`SELECT id FROM users WHERE email = ?`, [email]);
    if (!user) {
      const id = await insert(
        `INSERT INTO users (email, password_hash, name, company, bank_id, role, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          email,
          hash,
          role === 'bank' ? 'Sample Bank User' : 'Sample Corporate User',
          role === 'bank' ? null : 'Sample Corp LLC',
          bankId,
          role,
        ]
      );
      user = { id };
    }

    if (role === 'bank' && bankId) {
      await pool.execute(`UPDATE banks SET auto_invoice = ? WHERE id = ?`, [
        autoInvoice ? 1 : 0,
        bankId,
      ]);
    }

    return user.id;
  }

  let manualBankId = await queryOne<{ id: number }>(
    `SELECT id FROM banks WHERE name = 'Sample Manual Invoice Bank' LIMIT 1`
  );
  if (!manualBankId) {
    const id = await insert(
      `INSERT INTO banks (name, auto_invoice, is_active) VALUES ('Sample Manual Invoice Bank', 0, 1)`
    );
    manualBankId = { id };
  }

  const corporateUserId = await ensureUser('invoice-sample-corp@test.local', 'corporate', null, null);
  const bankUserId = await ensureUser(
    'invoice-sample-bank@test.local',
    'bank',
    manualBankId.id,
    false
  );

  const participantIds: Record<number, { userId: number; email: string; userType: string }> = {
    178: { userId: corporateUserId, email: 'corp-participant-178@test.local', userType: 'Corporate' },
    180: { userId: bankUserId, email: 'bank-participant-180@test.local', userType: 'Bank' },
    187: { userId: corporateUserId, email: 'individual-participant-187@test.local', userType: 'Individual' },
    188: { userId: corporateUserId, email: 'individual-participant-188@test.local', userType: 'Individual' },
  };

  for (const [pidStr, meta] of Object.entries(participantIds)) {
    const pid = Number(pidStr);
    const existing = await queryOne<{ id: number }>(`SELECT id FROM participants WHERE id = ?`, [pid]);
    if (!existing) {
      await pool.execute(
        `INSERT INTO participants (id, user_id, workshop_id, full_name, email, status)
         VALUES (?, ?, ?, ?, ?, 'confirmed')`,
        [pid, meta.userId, workshop.id, `Sample Participant ${pid}`, meta.email]
      );
    }

    if (meta.userType === 'Individual') {
      const reg = await queryOne<{ id: number }>(
        `SELECT id FROM registrations WHERE workshop_id = ? AND email = ? AND registration_type = 'Individual' LIMIT 1`,
        [workshop.id, meta.email]
      );
      if (!reg) {
        await pool.execute(
          `INSERT INTO registrations
             (workshop_id, registration_type, full_name, email, phone, company, total_seats, terms_accepted, total_amount, status)
           VALUES (?, 'Individual', ?, ?, '+971500000000', 'Sample Co', 1, 1, 1000.00, 'confirmed')`,
          [workshop.id, `Sample Individual ${pid}`, meta.email]
        );
      }
    }
  }

  for (const sample of SAMPLE_INVOICES) {
    const meta = participantIds[sample.orderId as keyof typeof participantIds];
    const invoiceNo = sample.invoiceNo || `SAMPLE-INV-${sample.id}`;
    const sentAt = sample.type === 'Automatic' ? new Date() : null;

    const existing = await queryOne<{ id: number }>(`SELECT id FROM invoices WHERE id = ?`, [sample.id]);
    if (existing) {
      await pool.execute(
        `UPDATE invoices
         SET invoice_number = ?, user_id = ?, workshop_id = ?, participant_id = ?,
             amount = 1000, vat_amount = 50, total_amount = 1050, status = 'sent', sent_at = ?
         WHERE id = ?`,
        [invoiceNo, meta.userId, workshop.id, sample.orderId, sentAt, sample.id]
      );
    } else {
      await pool.execute(
        `INSERT INTO invoices
           (id, invoice_number, user_id, workshop_id, participant_id, amount, vat_amount, total_amount, status, sent_at)
         VALUES (?, ?, ?, ?, ?, 1000, 50, 1050, 'sent', ?)`,
        [sample.id, invoiceNo, meta.userId, workshop.id, sample.orderId, sentAt]
      );
    }

    await pool.execute(`UPDATE participants SET invoice_id = ? WHERE id = ?`, [sample.id, sample.orderId]);
  }

  console.log('Sample invoice rows ensured.');
}

async function fetchViaApiLogic() {
  const rows = await query(
    `SELECT i.id,
            i.invoice_number,
            i.participant_id AS order_id,
            CASE
              WHEN u.role = 'bank' AND COALESCE(b.auto_invoice, 1) = 0 THEN 'Manual'
              WHEN i.sent_at IS NOT NULL THEN 'Automatic'
              ELSE 'Manual'
            END AS type,
            CASE
              WHEN reg.registration_type = 'Individual' THEN 'Individual'
              WHEN u.role = 'bank' THEN 'Bank'
              WHEN u.role = 'corporate' THEN 'Corporate'
              ELSE CONCAT(UPPER(LEFT(u.role, 1)), SUBSTRING(u.role, 2))
            END AS user_type
     FROM invoices i
     JOIN users u ON u.id = i.user_id
     JOIN workshops w ON w.id = i.workshop_id
     JOIN participants p ON p.id = i.participant_id
     LEFT JOIN banks b ON b.id = u.bank_id
     LEFT JOIN registrations reg
       ON reg.workshop_id = i.workshop_id
      AND reg.email = p.email
      AND reg.registration_type = 'Individual'
     WHERE i.id IN (1253, 1256, 1267, 1272)
     ORDER BY i.id`
  );

  return rows;
}

async function main() {
  await ensureSampleData();
  const rows = await fetchViaApiLogic();

  console.log('\nInvoice sample test results:\n');
  console.log('S.No\tInvoiceNo\tOrderId\tType\tUserType');
  for (const row of rows as Array<{
    id: number;
    invoice_number: string;
    order_id: number;
    type: string;
    user_type: string;
  }>) {
    const invoiceNo = row.invoice_number?.startsWith('SAMPLE-INV-') ? '' : row.invoice_number;
    console.log(`${row.id}\t${invoiceNo}\t${row.order_id}\t${row.type}\t${row.user_type}`);
  }

  const expected = SAMPLE_INVOICES.map((s) => ({
    id: s.id,
    order_id: s.orderId,
    type: s.type,
    user_type: s.userType,
  }));

  const actual = (rows as Array<{ id: number; order_id: number; type: string; user_type: string }>).map(
    (r) => ({ id: r.id, order_id: r.order_id, type: r.type, user_type: r.user_type })
  );

  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(pass ? '\n✓ All sample rows match expected Type and UserType.' : '\n✗ Mismatch vs expected.');
  if (!pass) {
    console.log('Expected:', expected);
    console.log('Actual:  ', actual);
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
