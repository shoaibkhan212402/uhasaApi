import { insert, pool, queryOne } from '../db/pool.js';
import { generateInvoiceNumber } from './orderReference.js';
import { buildInvoiceData } from './invoiceTemplate.js';
import { buildInvoicePdfAttachment } from './invoicePdfService.js';

const VAT_RATE = 0.05;

async function resolveInvoiceBillingContext(
  participantId: number,
  userId: number,
  workshopId: number,
  fallbackRecipientName: string
) {
  const participant = await queryOne<{ email: string }>(
    `SELECT email FROM participants WHERE id = ?`,
    [participantId]
  );

  const workshop = await queryOne<{
    title: string;
    format: string;
    start_date: string;
    end_date: string;
    price: number;
  }>(
    `SELECT title, format, start_date, end_date, price FROM workshops WHERE id = ?`,
    [workshopId]
  );
  if (!workshop) {
    throw new Error(`Workshop ${workshopId} not found`);
  }

  const user = await queryOne<{
    name: string;
    company: string | null;
    role: string;
    bank_id: number | null;
  }>(`SELECT name, company, role, bank_id FROM users WHERE id = ?`, [userId]);

  const bank = user?.bank_id
    ? await queryOne<{ name: string }>(`SELECT name FROM banks WHERE id = ?`, [user.bank_id])
    : null;

  const registration = participant?.email
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

  const participantCountRow = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM participants
     WHERE user_id = ? AND workshop_id = ? AND status != 'cancelled'`,
    [userId, workshopId]
  );

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

  const amount = params.price;
  const vatAmount = Math.round(amount * VAT_RATE * 100) / 100;
  const totalAmount = Math.round((amount + vatAmount) * 100) / 100;
  const invoiceNumber = await generateInvoiceNumber();
  const createdAt = new Date().toISOString();

  const invoiceId = await insert(
    `INSERT INTO invoices (invoice_number, user_id, workshop_id, participant_id, amount, vat_amount, total_amount, status, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', NOW())`,
    [invoiceNumber, params.userId, params.workshopId, params.participantId, amount, vatAmount, totalAmount]
  );

  await pool.execute(`UPDATE participants SET invoice_id = ? WHERE id = ?`, [invoiceId, params.participantId]);

  const billing = await resolveInvoiceBillingContext(
    params.participantId,
    params.userId,
    params.workshopId,
    params.recipientName
  );

  const invoiceData = buildInvoiceData({
    invoiceNumber,
    createdAt,
    billedTo: billing.billedTo,
    billedAddress: billing.billedAddress,
    billedTrn: billing.billedTrn,
    workshopTitle: billing.workshop.title,
    workshopFormat: billing.workshop.format,
    startDate: String(billing.workshop.start_date),
    endDate: String(billing.workshop.end_date),
    participantCount: billing.participantCount,
    unitPrice: Number(billing.workshop.price),
  });

  const invoiceAttachment = await buildInvoicePdfAttachment(invoiceData);

  await sendEmail({
    to: invoiceRecipient,
    subject: `Invoice ${invoiceNumber} — ${billing.workshop.title}`,
    html: invoiceEmailHtml({
      invoiceNumber,
      recipientName: params.recipientName,
      participantName: params.participantName,
      workshopTitle: billing.workshop.title,
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
    workshop_id: number;
    participant_id: number;
    amount: number;
    vat_amount: number;
    total_amount: number;
    created_at: string;
    participant_name: string;
    participant_email: string;
    workshop_title: string;
    user_email: string;
  }>(
    `SELECT i.id, i.invoice_number, i.user_id, i.workshop_id, i.participant_id,
            i.amount, i.vat_amount, i.total_amount, i.created_at,
            p.full_name AS participant_name, p.email AS participant_email,
            w.title AS workshop_title, u.email AS user_email
     FROM invoices i
     JOIN participants p ON p.id = i.participant_id
     JOIN workshops w ON w.id = i.workshop_id
     JOIN users u ON u.id = i.user_id
     WHERE i.id = ?`,
    [invoiceId]
  );

  if (!row) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  const registration = await queryOne<{ registration_type: string }>(
    `SELECT registration_type FROM registrations
     WHERE workshop_id = ? AND email = ?
     ORDER BY created_at DESC LIMIT 1`,
    [row.workshop_id, row.participant_email]
  );

  const invoiceRecipient =
    registration?.registration_type === 'Individual'
      ? row.participant_email
      : row.user_email;

  const billing = await resolveInvoiceBillingContext(
    row.participant_id,
    row.user_id,
    row.workshop_id,
    row.participant_name
  );

  const invoiceData = buildInvoiceData({
    invoiceNumber: row.invoice_number,
    createdAt: String(row.created_at),
    billedTo: billing.billedTo,
    billedAddress: billing.billedAddress,
    billedTrn: billing.billedTrn,
    workshopTitle: billing.workshop.title,
    workshopFormat: billing.workshop.format,
    startDate: String(billing.workshop.start_date),
    endDate: String(billing.workshop.end_date),
    participantCount: billing.participantCount,
    unitPrice: Number(billing.workshop.price),
  });

  const invoiceAttachment = await buildInvoicePdfAttachment(invoiceData);

  await sendEmail({
    to: invoiceRecipient,
    subject: `Invoice ${row.invoice_number} — ${billing.workshop.title}`,
    html: invoiceEmailHtml({
      invoiceNumber: row.invoice_number,
      recipientName: billing.billedTo,
      participantName: row.participant_name,
      workshopTitle: billing.workshop.title,
      amount: Number(row.amount),
      vatAmount: Number(row.vat_amount),
      totalAmount: Number(row.total_amount),
    }),
    templateType: 'invoice',
    participantId: row.participant_id,
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
