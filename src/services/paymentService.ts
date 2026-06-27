import { createHash, randomBytes } from 'crypto';
import { pool, insert, query, queryOne } from '../db/pool.js';
import { config } from '../config.js';
import { createRegistration, type CreateRegistrationInput } from './registrationService.js';
import { fulfillIndividualRegistration } from './individualRegistrationService.js';
import {
  registerWorkshopBooking,
  type PortalUser,
  type WorkshopRegistrationInput,
  type WorkshopRegistrationResult,
} from './participantService.js';
import {
  createTelrOrder,
  checkTelrOrder,
  isTelrPaymentAuthorized,
  isTelrPaymentCancelled,
  isTelrConfigured,
} from './telrService.js';

export type PaymentSource = 'public_cart' | 'portal_booking' | 'individual_portal';
export type PaymentStatus = 'pending' | 'authorized' | 'declined' | 'cancelled' | 'failed';

export interface PaymentRecord {
  id: number;
  cart_id: string;
  telr_order_ref: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  source: PaymentSource;
  context: Record<string, unknown>;
  customer_email: string;
  customer_name: string | null;
  telr_status_code: number | null;
  paid_at: string | null;
}

export interface CheckoutResult {
  cart_id: string;
  payment_url: string;
  amount: number;
}

export interface PaymentStatusResult {
  cart_id: string;
  status: PaymentStatus;
  amount: number;
  source: PaymentSource;
  paid_at: string | null;
  registration_ids?: number[];
  portal_order?: WorkshopRegistrationResult;
  message: string;
}

function generateCartId(): string {
  return `UASA-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

function telrReturnUrl(cartId: string, outcome: 'authorised' | 'declined' | 'cancelled'): string {
  const base = config.apiPublicUrl.replace(/\/$/, '');
  return `${base}/api/payments/telr/return/${encodeURIComponent(cartId)}?outcome=${outcome}`;
}

async function getPaymentByCartId(cartId: string): Promise<PaymentRecord | null> {
  const row = await queryOne<{
    id: number;
    cart_id: string;
    telr_order_ref: string | null;
    amount: number;
    currency: string;
    status: PaymentStatus;
    source: PaymentSource;
    context: string | Record<string, unknown>;
    customer_email: string;
    customer_name: string | null;
    telr_status_code: number | null;
    paid_at: string | null;
  }>(`SELECT * FROM payments WHERE cart_id = ?`, [cartId]);

  if (!row) return null;

  const context =
    typeof row.context === 'string' ? (JSON.parse(row.context) as Record<string, unknown>) : row.context;

  return { ...row, context };
}

async function createPaymentSession(
  source: PaymentSource,
  amount: number,
  customerEmail: string,
  customerName: string | undefined,
  context: Record<string, unknown>,
  description: string,
  customerPhone?: string
): Promise<CheckoutResult> {
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }

  if (!isTelrConfigured()) {
    throw new Error(
      'Online payment is not available. Please contact support or use bank transfer.'
    );
  }

  const cartId = generateCartId();

  await insert(
    `INSERT INTO payments (cart_id, amount, currency, status, source, context, customer_email, customer_name)
     VALUES (?, ?, 'AED', 'pending', ?, ?, ?, ?)`,
    [cartId, amount, source, JSON.stringify(context), customerEmail, customerName || null]
  );

  const telr = await createTelrOrder({
    cartId,
    amount,
    description,
    customerEmail,
    customerName,
    customerPhone,
    returnAuthorisedUrl: telrReturnUrl(cartId, 'authorised'),
    returnDeclinedUrl: telrReturnUrl(cartId, 'declined'),
    returnCancelledUrl: telrReturnUrl(cartId, 'cancelled'),
  });

  await pool.execute(
    `UPDATE payments SET telr_order_ref = ? WHERE cart_id = ?`,
    [telr.orderRef, cartId]
  );

  return { cart_id: cartId, payment_url: telr.paymentUrl, amount };
}

export async function createPublicCartCheckout(
  registrations: CreateRegistrationInput[],
  totalAmount: number,
  customerEmail: string,
  customerName?: string,
  customerPhone?: string
): Promise<CheckoutResult> {
  if (!registrations.length) {
    throw new Error('At least one registration is required');
  }

  const registrationIds: number[] = [];
  for (const reg of registrations) {
    const id = await createRegistration(reg);
    registrationIds.push(id);
  }

  const workshopCount = registrations.length;
  const description = `UASA Training — ${workshopCount} workshop${workshopCount !== 1 ? 's' : ''}`;

  return createPaymentSession(
    'public_cart',
    totalAmount,
    customerEmail,
    customerName,
    { registration_ids: registrationIds },
    description,
    customerPhone
  );
}

export async function createPortalBookingCheckout(
  user: PortalUser,
  input: WorkshopRegistrationInput
): Promise<CheckoutResult | { completed: true; order: WorkshopRegistrationResult }> {
  const result = await registerWorkshopBooking(user, input);

  if (result.total <= 0 || input.payment_method !== 'online') {
    return { completed: true, order: result };
  }

  const checkout = await createPaymentSession(
    'portal_booking',
    result.total,
    user.email,
    user.name,
    {
      participant_ids: result.participant_ids,
      workshop_id: result.workshop_id,
      order_id: result.order_id,
    },
    `UASA Training — ${result.workshop_title}`,
    undefined
  );

  return checkout;
}

export async function createIndividualPortalCheckout(
  registrationId: number,
  totalAmount: number,
  customerEmail: string,
  customerName: string,
  workshopTitle: string
): Promise<CheckoutResult> {
  return createPaymentSession(
    'individual_portal',
    totalAmount,
    customerEmail,
    customerName,
    { registration_id: registrationId },
    `UASA Training — ${workshopTitle}`.slice(0, 64)
  );
}

async function fulfillPayment(payment: PaymentRecord): Promise<void> {
  const ctx = payment.context;

  if (payment.source === 'public_cart') {
    const registrationIds = (ctx.registration_ids as number[]) || [];
    for (const registrationId of registrationIds) {
      const reg = await queryOne<{ registration_type: string }>(
        `SELECT registration_type FROM registrations WHERE id = ?`,
        [registrationId]
      );
      if (!reg) continue;

      if (reg.registration_type === 'Individual') {
        await fulfillIndividualRegistration(registrationId);
      } else {
        await pool.execute(`UPDATE registrations SET status = 'confirmed' WHERE id = ?`, [registrationId]);
      }
    }
  } else if (payment.source === 'portal_booking') {
    const participantIds = (ctx.participant_ids as number[]) || [];
    for (const participantId of participantIds) {
      const invoiceRow = await queryOne<{ invoice_id: number | null }>(
        `SELECT invoice_id FROM participants WHERE id = ?`,
        [participantId]
      );
      if (invoiceRow?.invoice_id) {
        await pool.execute(`UPDATE invoices SET status = 'paid' WHERE id = ?`, [invoiceRow.invoice_id]);
      }
    }
  } else if (payment.source === 'individual_portal') {
    const registrationId = ctx.registration_id as number;
    if (registrationId) {
      await fulfillIndividualRegistration(registrationId);
    }
  }

  await pool.execute(
    `UPDATE payments SET status = 'authorized', paid_at = NOW() WHERE id = ? AND status = 'pending'`,
    [payment.id]
  );
}

async function buildPortalOrderFromPayment(payment: PaymentRecord): Promise<WorkshopRegistrationResult | null> {
  const ctx = payment.context;
  const participantIds = (ctx.participant_ids as number[]) || [];
  const workshopId = ctx.workshop_id as number;
  if (!participantIds.length || !workshopId) return null;

  const workshop = await queryOne<{
    id: number;
    title: string;
    price: number;
    start_date: string;
    end_date: string;
    time_slot: string;
    format: string;
    cpd_hours: number;
  }>(
    `SELECT id, title, price, start_date, end_date, time_slot, format, cpd_hours
     FROM workshops WHERE id = ?`,
    [workshopId]
  );
  if (!workshop) return null;

  const placeholders = participantIds.map(() => '?').join(',');
  const enrolledList = await query<{
    id: number;
    full_name: string;
    email: string;
    phone: string | null;
    person_id: string | null;
    job_position: string | null;
    created_at: string;
    invoice_number: string | null;
    invoice_status: string | null;
    total_amount: number | null;
  }>(
    `SELECT
       p.id,
       p.full_name,
       p.email,
       p.phone,
       p.person_id,
       p.job_position,
       p.created_at,
       i.invoice_number,
       i.status AS invoice_status,
       i.total_amount
     FROM participants p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE p.id IN (${placeholders})
     ORDER BY p.full_name ASC`,
    participantIds
  );

  const subtotal = enrolledList.reduce((sum, r) => sum + Number(r.total_amount || 0) / 1.05, 0);
  const total = Number(payment.amount);
  const vat = Math.round((total - subtotal) * 100) / 100;

  return {
    message: 'Payment received — registration complete',
    workshop_id: workshop.id,
    workshop_title: workshop.title,
    payment_method: 'online',
    participant_count: enrolledList.length,
    unit_price: Number(workshop.price),
    subtotal: Math.round(subtotal * 100) / 100,
    vat,
    total,
    participant_ids: participantIds,
    failed: [],
    order_id: (ctx.order_id as string) || String(participantIds[0]).padStart(5, '0'),
    order_status: 'paid',
    created_at: enrolledList[0]?.created_at || new Date().toISOString(),
    workshop: {
      start_date: String(workshop.start_date),
      end_date: String(workshop.end_date),
      time_slot: workshop.time_slot,
      format: workshop.format,
      cpd_hours: workshop.cpd_hours,
    },
    participants: enrolledList.map((row) => ({
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      person_id: row.person_id,
      job_position: row.job_position,
      invoice_number: row.invoice_number,
      invoice_status: row.invoice_status,
      total_amount: row.total_amount != null ? Number(row.total_amount) : null,
    })),
  };
}

export async function completePayment(
  cartId: string,
  telrOrderRef?: string
): Promise<{ success: boolean; payment: PaymentRecord; reason?: string }> {
  const payment = await getPaymentByCartId(cartId);
  if (!payment) {
    throw new Error('Payment not found');
  }

  if (payment.status === 'authorized') {
    return { success: true, payment };
  }

  const orderRef = telrOrderRef || payment.telr_order_ref;
  if (!orderRef) {
    throw new Error('Missing Telr order reference');
  }

  const check = await checkTelrOrder(orderRef);

  await pool.execute(
    `UPDATE payments SET telr_status_code = ?, telr_response = ? WHERE cart_id = ?`,
    [check.statusCode, JSON.stringify(check.raw), cartId]
  );

  if (isTelrPaymentAuthorized(check.statusCode)) {
    await fulfillPayment(payment);
    const updated = await getPaymentByCartId(cartId);
    return { success: true, payment: updated || payment };
  }

  const newStatus: PaymentStatus = isTelrPaymentCancelled(check.statusCode) ? 'cancelled' : 'declined';
  await pool.execute(`UPDATE payments SET status = ? WHERE cart_id = ?`, [newStatus, cartId]);

  const updated = await getPaymentByCartId(cartId);
  return {
    success: false,
    payment: updated || payment,
    reason: isTelrPaymentCancelled(check.statusCode) ? 'cancelled' : 'declined',
  };
}

export async function getPaymentStatus(cartId: string): Promise<PaymentStatusResult> {
  let payment = await getPaymentByCartId(cartId);
  if (!payment) {
    throw new Error('Payment not found');
  }

  if (payment.status === 'pending' && payment.telr_order_ref) {
    try {
      const result = await completePayment(cartId);
      payment = result.payment;
    } catch {
      // Return last known state if Telr check fails
    }
  }

  const base: PaymentStatusResult = {
    cart_id: payment.cart_id,
    status: payment.status,
    amount: Number(payment.amount),
    source: payment.source,
    paid_at: payment.paid_at,
    message:
      payment.status === 'authorized'
        ? 'Payment successful'
        : payment.status === 'cancelled'
          ? 'Payment was cancelled'
          : payment.status === 'declined'
            ? 'Payment was declined'
            : 'Payment is pending',
  };

  if (payment.source === 'public_cart') {
    base.registration_ids = (payment.context.registration_ids as number[]) || [];
  }

  if (payment.source === 'portal_booking' && payment.status === 'authorized') {
    const portalOrder = await buildPortalOrderFromPayment(payment);
    if (portalOrder) {
      base.portal_order = portalOrder;
    }
  }

  return base;
}

export function getPaymentRedirectUrl(
  cartId: string,
  success: boolean,
  source: PaymentSource,
  reason?: string
): string {
  const frontend = config.frontendUrl.replace(/\/$/, '');

  if (success && source === 'portal_booking') {
    return `${frontend}/portal/payment/complete?cart_id=${encodeURIComponent(cartId)}`;
  }

  const status = success ? 'success' : reason === 'cancelled' ? 'cancelled' : 'failed';
  return `${frontend}/payment/result?status=${status}&cart_id=${encodeURIComponent(cartId)}`;
}

export async function handleTelrReturn(
  cartId: string,
  outcome: string,
  telrOrderRef?: string
): Promise<string> {
  if (outcome === 'authorised') {
    const result = await completePayment(cartId, telrOrderRef);
    const payment = result.payment;
    return getPaymentRedirectUrl(cartId, result.success, payment.source, result.reason);
  }

  const payment = await getPaymentByCartId(cartId);
  if (!payment) {
    return getPaymentRedirectUrl(cartId, false, 'public_cart', 'declined');
  }

  if (outcome === 'cancelled') {
    await pool.execute(`UPDATE payments SET status = 'cancelled' WHERE cart_id = ? AND status = 'pending'`, [
      cartId,
    ]);
    return getPaymentRedirectUrl(cartId, false, payment.source, 'cancelled');
  }

  await pool.execute(`UPDATE payments SET status = 'declined' WHERE cart_id = ? AND status = 'pending'`, [
    cartId,
  ]);
  return getPaymentRedirectUrl(cartId, false, payment.source, 'declined');
}

const TELR_TRAN_CHECK_FIELDS = [
  'tran_store',
  'tran_type',
  'tran_class',
  'tran_test',
  'tran_ref',
  'tran_prevref',
  'tran_firstref',
  'tran_currency',
  'tran_amount',
  'tran_cartid',
  'tran_desc',
  'tran_status',
  'tran_authcode',
  'tran_authmessage',
] as const;

function verifyTelrTranCheck(body: Record<string, string>, secret: string): boolean {
  const received = (body.tran_check || '').trim().toLowerCase();
  if (!received) return false;

  const signatureString = [
    secret,
    ...TELR_TRAN_CHECK_FIELDS.map((field) => (body[field] || '').trim()),
  ].join(':');

  const expected = createHash('sha1').update(signatureString).digest('hex').toLowerCase();
  return expected === received;
}

export async function handleTelrWebhook(body: Record<string, string>): Promise<void> {
  const secret = config.telr.webhookSecret;
  if (secret && body.tran_check && !verifyTelrTranCheck(body, secret)) {
    throw new Error('Invalid Telr webhook signature');
  }

  const cartId = (body.tran_cartid || '').trim();
  if (!cartId) return;

  const tranStatus = (body.tran_status || '').trim().toUpperCase();
  if (tranStatus === 'A' || tranStatus === 'H') {
    await completePayment(cartId, body.tran_order || body.tran_ref);
    return;
  }

  const payment = await getPaymentByCartId(cartId);
  if (!payment || payment.status !== 'pending') return;

  await pool.execute(`UPDATE payments SET status = 'declined' WHERE cart_id = ?`, [cartId]);
}
