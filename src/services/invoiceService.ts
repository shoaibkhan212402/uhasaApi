import { insert, pool, queryOne } from '../db/pool.js';
import { generateInvoiceNumber } from './orderReference.js';
import { buildInvoiceData } from './invoiceTemplate.js';
import { buildInvoicePdfAttachment } from './invoicePdfService.js';

const VAT_RATE = 0.05;

async function resolveInvoiceBillingContext(
  participantId: number | null,
  userId: number,
  workshopId: number | null,
  fallbackRecipientName: string
) {
  const participant = participantId
    ? await queryOne<{ email: string }>(
        `SELECT email FROM participants WHERE id = ?`,
        [participantId]
      )
    : null;

  const workshop = workshopId
    ? await queryOne<{
        title: string;
        format: string;
        start_date: string;
        end_date: string;
        price: number;
      }>(
        `SELECT title, format, start_date, end_date, price FROM workshops WHERE id = ?`,
        [workshopId]
      )
    : null;

  const user = await queryOne<{
    name: string;
    company: string | null;
    role: string;
    bank_id: number | null;
  }>(`SELECT name, company, role, bank_id FROM users WHERE id = ?`, [userId]);

  const bank = user?.bank_id
    ? await queryOne<{ name: string }>(`SELECT name FROM banks WHERE id = ?`, [user.bank_id])
    : null;

  const registration = participant?.email && workshopId
    ? await queryOne<{
        registration_type: string;
        full_name: string;
        company: string | null;
        company_address: string | null;
        company_trn: string | null;
        total_seats: number | null;
      }>(
        `SELECT registration_type, full_name, company, company_address, company_trn, total_seats
         FROM registrations
         WHERE workshop_id = ? AND email = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [workshopId, participant.email]
      )
    : null;

  const participantCountRow = workshopId
    ? await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM participants
         WHERE user_id = ? AND workshop_id = ? AND status != 'cancelled'`,
        [userId, workshopId]
      )
    : null;

  const isIndividual = registration?.registration_type === 'Individual';
  const participantCount = isIndividual
    ? Math.max(1, registration?.total_seats || 1)
    : Math.max(1, participantCountRow?.count || 1);

  let billedTo = fallbackRecipientName;
  if (isIndividual) {
    billedTo = registration?.company || registration?.full_name || fallbackRecipientName;
  } else if (user?.role === 'bank') {
    billedTo = bank?.name || user.company || user.name;
  } else {
    billedTo = user?.company || user?.name || fallbackRecipientName;
  }

  let billedAddress = registration?.company_address || null;
  let billedTrn = registration?.company_trn || null;

  if (!isIndividual && user) {
    const corporateRegistration = await queryOne<{
      company_address: string | null;
      company_trn: string | null;
    }>(
      `SELECT company_address, company_trn
       FROM registrations
       WHERE (company = ? OR email = (SELECT email FROM users WHERE id = ?))
         AND (
           (company_address IS NOT NULL AND company_address != '')
           OR (company_trn IS NOT NULL AND company_trn != '')
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.company, userId]
    );
    billedAddress = billedAddress || corporateRegistration?.company_address || null;
    billedTrn = billedTrn || corporateRegistration?.company_trn || null;
  }

  return { workshop, billedTo, billedAddress, billedTrn, participantCount };
}

export async function createAndSendInvoice(params: {
  userId: number;
  workshopId: number;
  participantId: number;
  participantName: string;
  recipientName: string;
  recipientEmail?: string;
  workshopTitle: string;
  price: number;
}): Promise<number | null> {
  const { sendEmail, invoiceEmailHtml } = await import('./emailService.js');

  const corporateUser = await queryOne<{ email: string }>(
    `SELECT email FROM users WHERE id = ?`,
    [params.userId]
  );
  const invoiceRecipient = params.recipientEmail || corporateUser?.email;
  if (!invoiceRecipient) {
    throw new Error('Invoice recipient email not found');
  }

  // Task 11: Group invoices monthly for portal users (corporate/bank/cto/cma)
  const existingInvoice = await queryOne<{ id: number; invoice_number: string; amount: string; created_at: string }>(
    `SELECT id, invoice_number, amount, created_at FROM invoices
     WHERE user_id = ?
       AND YEAR(created_at) = YEAR(NOW())
       AND MONTH(created_at) = MONTH(NOW())
       AND registration_id IS NULL
     ORDER BY id ASC LIMIT 1`,
    [params.userId]
  );

  let invoiceId: number;
  let invoiceNumber: string;
  let amount: number;
  let vatAmount: number;
  let totalAmount: number;
  let createdAtStr: string;

  if (existingInvoice) {
    invoiceId = existingInvoice.id;
    invoiceNumber = existingInvoice.invoice_number;
    amount = Math.round((Number(existingInvoice.amount) + params.price) * 100) / 100;
    vatAmount = Math.round(amount * VAT_RATE * 100) / 100;
    totalAmount = Math.round((amount + vatAmount) * 100) / 100;
    createdAtStr = new Date(existingInvoice.created_at).toISOString();

    await pool.execute(
      `UPDATE invoices SET amount = ?, vat_amount = ?, total_amount = ? WHERE id = ?`,
      [amount, vatAmount, totalAmount, invoiceId]
    );
  } else {
    amount = params.price;
    vatAmount = Math.round(amount * VAT_RATE * 100) / 100;
    totalAmount = Math.round((amount + vatAmount) * 100) / 100;
    invoiceNumber = await generateInvoiceNumber();
    createdAtStr = new Date().toISOString();

    invoiceId = await insert(
      `INSERT INTO invoices (invoice_number, user_id, workshop_id, participant_id, amount, vat_amount, total_amount, status, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', NOW())`,
      [invoiceNumber, params.userId, params.workshopId, params.participantId, amount, vatAmount, totalAmount]
    );
  }

  await pool.execute(`UPDATE participants SET invoice_id = ? WHERE id = ?`, [invoiceId, params.participantId]);

  const billing = await resolveInvoiceBillingContext(
    params.participantId,
    params.userId,
    params.workshopId,
    params.recipientName
  );

  // For monthly grouped invoice, we fetch the total number of participants on this invoice
  const [participantCountRows] = await pool.query<any[]>(
    `SELECT COUNT(*) as count FROM participants WHERE invoice_id = ? AND status != 'cancelled'`,
    [invoiceId]
  );
  const totalParticipantCount = participantCountRows[0]?.count || billing.participantCount;

  const invoiceData = buildInvoiceData({
    invoiceNumber,
    createdAt: createdAtStr,
    billedTo: billing.billedTo,
    billedAddress: billing.billedAddress,
    billedTrn: billing.billedTrn,
    workshopTitle: billing.workshop?.title || 'CPD Training Program',
    workshopFormat: billing.workshop?.format || 'Online',
    startDate: billing.workshop ? String(billing.workshop.start_date) : createdAtStr,
    endDate: billing.workshop ? String(billing.workshop.end_date) : createdAtStr,
    participantCount: totalParticipantCount,
    unitPrice: billing.workshop ? Number(billing.workshop.price) : amount,
    subtotal: amount,
    vatAmount,
    totalAmount,
  });

  const invoiceAttachment = await buildInvoicePdfAttachment(invoiceData);

  await sendEmail({
    to: invoiceRecipient,
    subject: `Invoice ${invoiceNumber} — ${billing.workshop?.title || 'Consolidated CPD Program'}`,
    html: invoiceEmailHtml({
      invoiceNumber,
      recipientName: params.recipientName,
      participantName: params.participantName,
      workshopTitle: billing.workshop?.title || 'Consolidated CPD Program',
      amount,
      vatAmount,
      totalAmount,
    }),
    templateType: 'invoice',
    participantId: params.participantId,
    attachments: [invoiceAttachment],
  });

  return invoiceId;
}

export async function resendInvoiceEmail(invoiceId: number): Promise<void> {
  const { sendEmail, invoiceEmailHtml } = await import('./emailService.js');

  const row = await queryOne<{
    id: number;
    invoice_number: string;
    user_id: number;
    workshop_id: number | null;
    participant_id: number | null;
    amount: number;
    vat_amount: number;
    total_amount: number;
    created_at: string;
    participant_name: string | null;
    participant_email: string | null;
    workshop_title: string | null;
    user_email: string;
  }>(
    `SELECT i.id, i.invoice_number, i.user_id, i.workshop_id, i.participant_id,
            i.amount, i.vat_amount, i.total_amount, i.created_at,
            p.full_name AS participant_name, p.email AS participant_email,
            w.title AS workshop_title, u.email AS user_email
     FROM invoices i
     LEFT JOIN participants p ON p.id = i.participant_id
     LEFT JOIN workshops w ON w.id = i.workshop_id
     JOIN users u ON u.id = i.user_id
     WHERE i.id = ?`,
    [invoiceId]
  );

  if (!row) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  const registration = row.workshop_id && row.participant_email
    ? await queryOne<{ registration_type: string }>(
        `SELECT registration_type FROM registrations
         WHERE workshop_id = ? AND email = ?
         ORDER BY created_at DESC LIMIT 1`,
        [row.workshop_id, row.participant_email]
      )
    : null;

  const invoiceRecipient =
    registration?.registration_type === 'Individual' && row.participant_email
      ? row.participant_email
      : row.user_email;

  const billing = await resolveInvoiceBillingContext(
    row.participant_id,
    row.user_id,
    row.workshop_id,
    row.participant_name || ''
  );

  const [participantCountRows] = await pool.query<any[]>(
    `SELECT COUNT(*) as count FROM participants WHERE invoice_id = ? AND status != 'cancelled'`,
    [invoiceId]
  );
  const totalParticipantCount = participantCountRows[0]?.count || billing.participantCount;

  const invoiceData = buildInvoiceData({
    invoiceNumber: row.invoice_number,
    createdAt: String(row.created_at),
    billedTo: billing.billedTo,
    billedAddress: billing.billedAddress,
    billedTrn: billing.billedTrn,
    workshopTitle: billing.workshop?.title || 'CPD Training Program',
    workshopFormat: billing.workshop?.format || 'Online',
    startDate: billing.workshop ? String(billing.workshop.start_date) : String(row.created_at),
    endDate: billing.workshop ? String(billing.workshop.end_date) : String(row.created_at),
    participantCount: totalParticipantCount,
    unitPrice: billing.workshop ? Number(billing.workshop.price) : Number(row.amount),
    subtotal: Number(row.amount),
    vatAmount: Number(row.vat_amount),
    totalAmount: Number(row.total_amount),
  });

  const invoiceAttachment = await buildInvoicePdfAttachment(invoiceData);

  await sendEmail({
    to: invoiceRecipient,
    subject: `Invoice ${row.invoice_number} — ${billing.workshop?.title || 'Consolidated CPD Program'}`,
    html: invoiceEmailHtml({
      invoiceNumber: row.invoice_number,
      recipientName: billing.billedTo,
      participantName: row.participant_name || 'Participants',
      workshopTitle: billing.workshop?.title || 'Consolidated CPD Program',
      amount: Number(row.amount),
      vatAmount: Number(row.vat_amount),
      totalAmount: Number(row.total_amount),
    }),
    templateType: 'invoice',
    participantId: row.participant_id || 0,
    attachments: [invoiceAttachment],
  });
}

export function shouldSendInvoice(userRole: string, bankAutoInvoice: boolean | null): boolean {
  if (userRole === 'cto' || userRole === 'cma') return false;
  if (userRole === 'corporate') return true;
  if (userRole === 'bank') return bankAutoInvoice !== false;
  return false;
}

export { buildInvoiceData, invoiceHtml as invoiceDownloadHtml } from './invoiceTemplate.js';
export type { InvoiceData } from './invoiceTemplate.js';
