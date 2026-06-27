import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { insert, pool, queryOne } from '../db/pool.js';
import { createAndSendInvoice } from './invoiceService.js';
import { confirmationEmailHtml, sendEmail } from './emailService.js';
import {
  INDIVIDUAL_SYSTEM_USER_EMAIL,
  migrateIndividualRecords,
} from './individualPortalService.js';

async function getOrCreateIndividualSystemUser(): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE email = ?`,
    [INDIVIDUAL_SYSTEM_USER_EMAIL]
  );
  if (existing) return existing.id;

  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  return insert(
    `INSERT INTO users (email, password_hash, name, company, role, is_active)
     VALUES (?, ?, 'Individual Registrations', 'Individual', 'corporate', 0)`,
    [INDIVIDUAL_SYSTEM_USER_EMAIL, passwordHash]
  );
}

export async function getOrCreateIndividualUser(
  email: string,
  fullName: string,
  password?: string
): Promise<number> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE LOWER(email) = ? AND role = 'individual'`,
    [normalizedEmail]
  );
  if (existing) {
    await migrateIndividualRecords(existing.id, normalizedEmail);
    return existing.id;
  }

  if (!password) {
    return getOrCreateIndividualSystemUser();
  }

  const hash = await bcrypt.hash(password, 10);

  const userId = await insert(
    `INSERT INTO users (email, password_hash, name, company, role, is_active, must_change_password)
     VALUES (?, ?, ?, NULL, 'individual', 1, 0)`,
    [normalizedEmail, hash, fullName || normalizedEmail]
  );

  await migrateIndividualRecords(userId, normalizedEmail);
  return userId;
}

export async function fulfillIndividualRegistration(registrationId: number): Promise<void> {
  const reg = await queryOne<{
    id: number;
    workshop_id: number;
    registration_type: string;
    full_name: string;
    email: string;
    phone: string | null;
    person_id: string | null;
    job_position: string | null;
    company: string | null;
    status: string;
  }>(
    `SELECT id, workshop_id, registration_type, full_name, email, phone, person_id, job_position, company, status
     FROM registrations WHERE id = ?`,
    [registrationId]
  );

  if (!reg || reg.registration_type !== 'Individual' || reg.status === 'cancelled') {
    return;
  }

  const workshop = await queryOne<{
    id: number;
    title: string;
    price: number;
    start_date: string;
    time_slot: string;
  }>(
    `SELECT id, title, price, start_date, time_slot FROM workshops WHERE id = ?`,
    [reg.workshop_id]
  );
  if (!workshop) {
    throw new Error(`Workshop ${reg.workshop_id} not found`);
  }

  const individualUserId = await getOrCreateIndividualUser(reg.email, reg.full_name);
  const systemUserId = await getOrCreateIndividualSystemUser();
  const ownerUserId =
    individualUserId === systemUserId ? systemUserId : individualUserId;

  const existingParticipant = await queryOne<{
    id: number;
    user_id: number;
    invoice_id: number | null;
    confirmation_sent: number;
  }>(
    `SELECT id, user_id, invoice_id, confirmation_sent FROM participants
     WHERE workshop_id = ? AND LOWER(email) = LOWER(?) AND status != 'cancelled'
       AND user_id IN (?, ?)
     ORDER BY id DESC LIMIT 1`,
    [reg.workshop_id, reg.email, ownerUserId, systemUserId]
  );

  let participantId = existingParticipant?.id;
  if (!participantId) {
    participantId = await insert(
      `INSERT INTO participants (user_id, workshop_id, full_name, email, phone, person_id, job_position, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
      [
        ownerUserId,
        reg.workshop_id,
        reg.full_name,
        reg.email,
        reg.phone || null,
        reg.person_id || null,
        reg.job_position || null,
      ]
    );
  } else if (existingParticipant && existingParticipant.user_id === systemUserId && ownerUserId !== systemUserId) {
    await pool.execute(`UPDATE participants SET user_id = ? WHERE id = ?`, [
      ownerUserId,
      participantId,
    ]);
  }

  const price = Number(workshop.price);
  if (price > 0 && !existingParticipant?.invoice_id) {
    await createAndSendInvoice({
      userId: ownerUserId,
      workshopId: workshop.id,
      participantId,
      participantName: reg.full_name,
      recipientName: reg.full_name,
      recipientEmail: reg.email,
      workshopTitle: workshop.title,
      price,
    });
  } else if (existingParticipant?.invoice_id && existingParticipant.user_id === systemUserId && ownerUserId !== systemUserId) {
    await pool.execute(`UPDATE invoices SET user_id = ? WHERE id = ?`, [
      ownerUserId,
      existingParticipant.invoice_id,
    ]);
  }

  const confirmationSent = existingParticipant?.confirmation_sent === 1;
  if (!confirmationSent) {
    await sendEmail({
      to: reg.email,
      subject: `Registration Confirmed — ${workshop.title}`,
      html: confirmationEmailHtml({
        participantName: reg.full_name,
        workshopTitle: workshop.title,
        startDate: String(workshop.start_date).slice(0, 10),
        timeSlot: workshop.time_slot,
        organizationName: reg.company || reg.full_name,
      }),
      templateType: 'confirmation',
      participantId,
    });
    await pool.execute(`UPDATE participants SET confirmation_sent = 1 WHERE id = ?`, [participantId]);
  }

  if (reg.status === 'pending') {
    await pool.execute(`UPDATE registrations SET status = 'confirmed' WHERE id = ?`, [registrationId]);
  }
}

const DEFAULT_WORKSHOP_FEE = 1950;
const VAT_RATE = 0.05;

export async function createPendingIndividualRegistration(
  userId: number,
  email: string,
  name: string,
  workshopId: number,
  details: {
    terms_accepted: boolean;
    phone?: string | null;
    person_id?: string | null;
    job_position?: string | null;
    company?: string | null;
  }
): Promise<{ registrationId: number; workshopTitle: string; totalAmount: number }> {
  if (!details.terms_accepted) {
    throw new Error('You must accept the terms and conditions');
  }

  const {
    isIndividualEnrolledInWorkshop,
    getIndividualRegistrationDefaults,
    migrateIndividualRecords,
  } = await import('./individualPortalService.js');

  await migrateIndividualRecords(userId, email);

  if (await isIndividualEnrolledInWorkshop(userId, email, workshopId)) {
    throw new Error('You are already registered for this workshop');
  }

  const workshop = await queryOne<{
    id: number;
    title: string;
    price: number | null;
    total_seats: number;
    registration_open: number | null;
    is_published: number;
    end_date: string;
  }>(
    `SELECT id, title, price, total_seats, registration_open, is_published, end_date
     FROM workshops WHERE id = ?`,
    [workshopId]
  );

  if (!workshop || !workshop.is_published) {
    throw new Error('Workshop not found');
  }
  if (String(workshop.end_date).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
    throw new Error('Registration is closed for this workshop');
  }
  if (workshop.registration_open === 0) {
    throw new Error('Registration is not open for this workshop');
  }

  const seatRows = await queryOne<{ registered: number }>(
    `SELECT
       COALESCE((
         SELECT SUM(COALESCE(total_seats, 1))
         FROM registrations WHERE workshop_id = ? AND status != 'cancelled'
       ), 0)
       + COALESCE((
         SELECT COUNT(*) FROM participants WHERE workshop_id = ? AND status != 'cancelled'
       ), 0) AS registered`,
    [workshopId, workshopId]
  );
  const registered = Number(seatRows?.registered) || 0;
  if (registered + 1 > workshop.total_seats) {
    throw new Error('Not enough seats available for this workshop');
  }

  const defaults = await getIndividualRegistrationDefaults(userId, email);
  const unitPrice = Number(workshop.price) > 0 ? Number(workshop.price) : DEFAULT_WORKSHOP_FEE;
  const totalAmount = Math.round(unitPrice * (1 + VAT_RATE) * 100) / 100;

  const registrationId = await insert(
    `INSERT INTO registrations (
      workshop_id, registration_type, person_id, full_name, job_position, email, phone,
      company, terms_accepted, total_amount, status
    ) VALUES (?, 'Individual', ?, ?, ?, ?, ?, ?, 1, ?, 'pending')`,
    [
      workshopId,
      details.person_id ?? defaults?.person_id ?? null,
      name,
      details.job_position ?? defaults?.job_position ?? null,
      email,
      details.phone ?? defaults?.phone ?? null,
      details.company ?? defaults?.company ?? null,
      totalAmount,
    ]
  );

  return { registrationId, workshopTitle: workshop.title, totalAmount };
}

export async function registerIndividualForWorkshop(
  userId: number,
  email: string,
  name: string,
  workshopId: number,
  details: {
    terms_accepted: boolean;
    phone?: string | null;
    person_id?: string | null;
    job_position?: string | null;
    company?: string | null;
  }
): Promise<{ registrationId: number; workshopTitle: string }> {
  const pending = await createPendingIndividualRegistration(userId, email, name, workshopId, details);
  await fulfillIndividualRegistration(pending.registrationId);
  return { registrationId: pending.registrationId, workshopTitle: pending.workshopTitle };
}
