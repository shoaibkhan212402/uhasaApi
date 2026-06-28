import { insert, pool, query, queryOne } from '../db/pool.js';
import { createAndSendInvoice, shouldSendInvoice } from './invoiceService.js';
import { formatOrderId } from './orderReference.js';
import { participantPriceAtPosition, calculateEnrollmentSubtotal } from './memberPricing.js';
import { confirmationEmailHtml, sendEmail } from './emailService.js';
import * as XLSX from 'xlsx';

export interface PortalUser {
  id: number;
  email: string;
  name: string;
  role: 'corporate' | 'bank' | 'cto' | 'cma';
  company: string | null;
  bank_id: number | null;
}

export interface AddParticipantInput {
  workshop_id?: number | null;
  full_name: string;
  email: string;
  phone?: string;
  person_id?: string;
  job_position?: string;
}

async function assertWorkshopSeatsAvailable(workshopId: number) {
  const workshop = await queryOne<{
    id: number;
    title: string;
    price: number;
    total_seats: number;
    cto_cma_limit: number;
    cma_limit: number | null;
    hct_limit: number | null;
    start_date: string;
    end_date: string;
    time_slot: string;
    is_published: number;
  }>(
    `SELECT id, title, price, total_seats, cto_cma_limit, cma_limit, hct_limit, start_date, end_date, time_slot, is_published
     FROM workshops WHERE id = ? AND is_published = 1 AND end_date >= CURDATE()`,
    [workshopId]
  );

  if (!workshop) {
    throw new Error('Workshop not found or no longer available');
  }

  const portalCount = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM participants WHERE workshop_id = ? AND status != 'cancelled'`,
    [workshopId]
  );
  const individualSeats = await queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(total_seats), 0) as total FROM registrations
     WHERE workshop_id = ? AND status != 'cancelled'`,
    [workshopId]
  );
  const portalSeats = portalCount?.cnt || 0;
  const regSeats = individualSeats?.total || 0;
  if (portalSeats + regSeats >= workshop.total_seats) {
    throw new Error('No seats available for this workshop');
  }

  return workshop;
}

async function addRosterParticipant(user: PortalUser, input: AddParticipantInput) {
  const existing = await queryOne(
    `SELECT id FROM participants WHERE user_id = ? AND workshop_id IS NULL AND email = ? AND status != 'cancelled'`,
    [user.id, input.email]
  );
  if (existing) {
    throw new Error('This participant is already in your roster');
  }

  return insert(
    `INSERT INTO participants (user_id, workshop_id, full_name, email, phone, person_id, job_position, status)
     VALUES (?, NULL, ?, ?, ?, ?, ?, 'confirmed')`,
    [
      user.id,
      input.full_name,
      input.email,
      input.phone || null,
      input.person_id || null,
      input.job_position || null,
    ]
  );
}

export async function addParticipant(user: PortalUser, input: AddParticipantInput) {
  if (!input.workshop_id) {
    return addRosterParticipant(user, input);
  }

  const workshop = await assertWorkshopSeatsAvailable(input.workshop_id);

  const start = new Date(workshop.start_date);
  const hoursDiff = (start.getTime() - Date.now()) / (3600 * 1000);
  if (hoursDiff < 24) {
    throw new Error('Registration is locked within 24 hours of the workshop start time.');
  }

  const existing = await queryOne(
    `SELECT id FROM participants WHERE user_id = ? AND workshop_id = ? AND email = ? AND status != 'cancelled'`,
    [user.id, input.workshop_id, input.email]
  );
  if (existing) {
    throw new Error('This participant is already registered for this workshop');
  }

  const enrolledCountRow = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM participants WHERE user_id = ? AND workshop_id = ? AND status != 'cancelled'`,
    [user.id, input.workshop_id]
  );
  const enrolledCount = enrolledCountRow?.count || 0;

  if (user.role === 'cto') {
    const limit = workshop.hct_limit !== null ? workshop.hct_limit : (workshop.cto_cma_limit ?? 3);
    if (enrolledCount >= limit) {
      throw new Error(`HCT registration limit reached (${limit} participants per workshop)`);
    }
  } else if (user.role === 'cma') {
    const limit = workshop.cma_limit !== null ? workshop.cma_limit : (workshop.cto_cma_limit ?? 3);
    if (enrolledCount >= limit) {
      throw new Error(`CMA registration limit reached (${limit} participants per workshop)`);
    }
  }

  const participantId = await insert(
    `INSERT INTO participants (user_id, workshop_id, full_name, email, phone, person_id, job_position, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
    [
      user.id,
      input.workshop_id,
      input.full_name,
      input.email,
      input.phone || null,
      input.person_id || null,
      input.job_position || null,
    ]
  );

  let bankAutoInvoice: boolean | null = true;
  if (user.role === 'bank' && user.bank_id) {
    const bank = await queryOne<{ auto_invoice: number }>(
      `SELECT auto_invoice FROM banks WHERE id = ? AND is_active = 1`,
      [user.bank_id]
    );
    bankAutoInvoice = bank ? bank.auto_invoice === 1 : true;
  }

  const orgName = user.company || user.name;

  const participantPrice = participantPriceAtPosition(
    Number(workshop.price),
    enrolledCount + 1,
    user.role
  );

  if (shouldSendInvoice(user.role, bankAutoInvoice) && participantPrice > 0) {
    await createAndSendInvoice({
      userId: user.id,
      workshopId: workshop.id,
      participantId,
      participantName: input.full_name,
      recipientName: orgName,
      workshopTitle: workshop.title,
      price: participantPrice,
    });
  }

  await sendEmail({
    to: input.email,
    subject: `Registration Confirmed — ${workshop.title}`,
    html: confirmationEmailHtml({
      participantName: input.full_name,
      workshopTitle: workshop.title,
      startDate: String(workshop.start_date).slice(0, 10),
      timeSlot: workshop.time_slot,
      organizationName: orgName,
    }),
    templateType: 'confirmation',
    participantId,
  });

  await pool.execute(`UPDATE participants SET confirmation_sent = 1 WHERE id = ?`, [participantId]);

  return participantId;
}

export async function listParticipants(userId: number, workshopId?: number) {
  const params: unknown[] = [userId];
  let sql = `
    SELECT p.*, w.title as workshop_title, w.start_date, w.end_date, w.time_slot,
           i.invoice_number, i.total_amount as invoice_total, i.status as invoice_status
    FROM participants p
    LEFT JOIN workshops w ON w.id = p.workshop_id
    LEFT JOIN invoices i ON i.id = p.invoice_id
    WHERE p.user_id = ?
  `;
  if (workshopId) {
    sql += ` AND p.workshop_id = ?`;
    params.push(workshopId);
  }
  sql += ` ORDER BY p.created_at DESC`;
  return query(sql, params);
}

export async function getParticipantCountForWorkshop(userId: number, workshopId: number) {
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM participants WHERE user_id = ? AND workshop_id = ? AND status != 'cancelled'`,
    [userId, workshopId]
  );
  return row?.count || 0;
}

export interface ImportParticipantRow {
  person_id: string;
  full_name: string;
  job_position: string;
  email: string;
  phone: string;
}

export interface BulkImportResult {
  added: number;
  failed: { row: number; email: string; error: string }[];
  participant_ids: number[];
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const HEADER_ALIASES: Record<string, keyof ImportParticipantRow> = {
  person_id: 'person_id',
  personid: 'person_id',
  id: 'person_id',
  cma_person_id: 'person_id',
  full_name: 'full_name',
  fullname: 'full_name',
  name: 'full_name',
  job_position: 'job_position',
  jobposition: 'job_position',
  position: 'job_position',
  job_title: 'job_position',
  email: 'email',
  email_address: 'email',
  phone: 'phone',
  mobile: 'phone',
  mobile_number: 'phone',
  phone_number: 'phone',
};

export function parseParticipantSpreadsheet(buffer: Buffer): ImportParticipantRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const participants: ImportParticipantRow[] = [];

  for (const row of rows) {
    const mapped: Partial<ImportParticipantRow> = {};
    for (const [key, value] of Object.entries(row)) {
      const field = HEADER_ALIASES[normalizeHeader(key)];
      if (field) mapped[field] = String(value ?? '').trim();
    }

    const person_id = mapped.person_id?.trim() || '';
    const full_name = mapped.full_name?.trim() || '';
    const job_position = mapped.job_position?.trim() || '';
    const email = mapped.email?.trim() || '';
    const phone = mapped.phone?.trim() || '';

    if (!person_id && !full_name && !email && !phone && !job_position) continue;

    participants.push({ person_id, full_name, job_position, email, phone });
  }

  return participants;
}

export async function bulkAddParticipants(
  user: PortalUser,
  workshopId: number | null | undefined,
  rows: ImportParticipantRow[]
): Promise<BulkImportResult> {
  const result: BulkImportResult = { added: 0, failed: [], participant_ids: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    if (!row.person_id || !row.full_name || !row.job_position || !row.email || !row.phone) {
      result.failed.push({
        row: rowNum,
        email: row.email || '(missing)',
        error: 'Person ID, Full Name, Job Position, Email Address, and Mobile Number are required',
      });
      continue;
    }

    try {
      const id = await addParticipant(user, {
        ...(workshopId ? { workshop_id: workshopId } : {}),
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        person_id: row.person_id,
        job_position: row.job_position,
      });
      result.added += 1;
      result.participant_ids.push(id);
    } catch (err) {
      result.failed.push({
        row: rowNum,
        email: row.email,
        error: err instanceof Error ? err.message : 'Failed to add participant',
      });
    }
  }

  return result;
}

export interface UpdateParticipantInput {
  full_name?: string;
  email?: string;
  phone?: string;
  person_id?: string;
  job_position?: string;
  workshop_id?: number | null;
}

async function assertWorkshopTransferAllowed(
  userId: number,
  userRole: string,
  participantId: number,
  currentWorkshopId: number | null,
  newWorkshopId: number | null,
  email: string
) {
  if (newWorkshopId === currentWorkshopId) {
    return;
  }

  if (currentWorkshopId !== null) {
    const attended = await queryOne<{ attended: number }>(
      `SELECT attended FROM participants WHERE id = ? AND user_id = ?`,
      [participantId, userId]
    );
    if (attended?.attended) {
      throw new Error('Cannot change workshop after attendance has been recorded');
    }

    const invoice = await queryOne<{ invoice_id: number | null; status: string | null }>(
      `SELECT p.invoice_id, i.status
       FROM participants p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.id = ? AND p.user_id = ?`,
      [participantId, userId]
    );
    if (invoice?.invoice_id && invoice.status === 'paid') {
      throw new Error(
        'Cannot change workshop after payment. Cancel this enrollment and register again, or contact support.'
      );
    }
  }

  if (newWorkshopId === null) {
    return;
  }

  const workshop = await queryOne<{
    id: number;
    title: string;
    price: number;
    total_seats: number;
    cto_cma_limit: number;
    cma_limit: number | null;
    hct_limit: number | null;
    is_published: number;
  }>(
    `SELECT id, title, price, total_seats, cto_cma_limit, cma_limit, hct_limit, is_published
     FROM workshops WHERE id = ? AND is_published = 1 AND end_date >= CURDATE()`,
    [newWorkshopId]
  );

  if (!workshop) {
    throw new Error('Target workshop not found or no longer available');
  }

  const duplicate = await queryOne(
    `SELECT id FROM participants
     WHERE user_id = ? AND workshop_id = ? AND email = ? AND status != 'cancelled' AND id != ?`,
    [userId, newWorkshopId, email, participantId]
  );
  if (duplicate) {
    throw new Error('This participant is already registered for the selected workshop');
  }

  if (userRole === 'cto' || userRole === 'cma') {
    const countRow = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM participants WHERE user_id = ? AND workshop_id = ? AND status != 'cancelled'`,
      [userId, newWorkshopId]
    );
    const limit = userRole === 'cto'
      ? (workshop.hct_limit !== null ? workshop.hct_limit : (workshop.cto_cma_limit ?? 3))
      : (workshop.cma_limit !== null ? workshop.cma_limit : (workshop.cto_cma_limit ?? 3));
    if ((countRow?.count || 0) >= limit) {
      throw new Error(`Registration limit reached (${limit} participants per workshop)`);
    }
  }

  const portalCount = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM participants WHERE workshop_id = ? AND status != 'cancelled'`,
    [newWorkshopId]
  );
  const individualSeats = await queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(total_seats), 0) as total FROM registrations
     WHERE workshop_id = ? AND status != 'cancelled'`,
    [newWorkshopId]
  );
  const portalSeats = portalCount?.cnt || 0;
  const regSeats = individualSeats?.total || 0;
  if (portalSeats + regSeats >= workshop.total_seats) {
    throw new Error('No seats available for the selected workshop');
  }
}

export async function updateParticipant(
  userId: number,
  userRole: string,
  participantId: number,
  input: UpdateParticipantInput
) {
  const existing = await queryOne<{
    id: number;
    workshop_id: number | null;
    email: string;
    status: string;
    invoice_id: number | null;
  }>(
    `SELECT id, workshop_id, email, status, invoice_id FROM participants WHERE id = ? AND user_id = ?`,
    [participantId, userId]
  );

  if (!existing || existing.status === 'cancelled') {
    throw new Error('Participant not found');
  }

  // Task 12: Enforce 24-hour lock on existing workshop
  if (userRole !== 'admin' && existing.workshop_id !== null) {
    const currentWorkshop = await queryOne<{ start_date: string }>(
      `SELECT start_date FROM workshops WHERE id = ?`,
      [existing.workshop_id]
    );
    if (currentWorkshop) {
      const start = new Date(currentWorkshop.start_date);
      const hoursDiff = (start.getTime() - Date.now()) / (3600 * 1000);
      if (hoursDiff < 24) {
        throw new Error('Modifications are locked within 24 hours of the workshop start time.');
      }
    }
  }

  // Task 12: Enforce 24-hour lock on target workshop
  if (
    userRole !== 'admin' &&
    input.workshop_id !== undefined &&
    input.workshop_id !== existing.workshop_id &&
    input.workshop_id !== null
  ) {
    const targetWorkshop = await queryOne<{ start_date: string }>(
      `SELECT start_date FROM workshops WHERE id = ?`,
      [input.workshop_id]
    );
    if (targetWorkshop) {
      const start = new Date(targetWorkshop.start_date);
      const hoursDiff = (start.getTime() - Date.now()) / (3600 * 1000);
      if (hoursDiff < 24) {
        throw new Error('Target workshop start time is within 24 hours. Transfer is locked.');
      }
    }
  }

  const targetWorkshopId =
    input.workshop_id !== undefined ? input.workshop_id : existing.workshop_id;
  const targetEmail = input.email ?? existing.email;

  if (targetWorkshopId !== existing.workshop_id) {
    await assertWorkshopTransferAllowed(
      userId,
      userRole,
      participantId,
      existing.workshop_id,
      targetWorkshopId,
      targetEmail
    );
  }

  if (input.email && input.email !== existing.email) {
    if (targetWorkshopId === null) {
      const dup = await queryOne(
        `SELECT id FROM participants WHERE user_id = ? AND workshop_id IS NULL AND email = ? AND status != 'cancelled' AND id != ?`,
        [userId, input.email, participantId]
      );
      if (dup) {
        throw new Error('This email is already in your roster');
      }
    } else {
      const dup = await queryOne(
        `SELECT id FROM participants WHERE user_id = ? AND workshop_id = ? AND email = ? AND status != 'cancelled' AND id != ?`,
        [userId, targetWorkshopId, input.email, participantId]
      );
      if (dup) {
        throw new Error('This email is already registered for this workshop');
      }
    }
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  const fields: (keyof Omit<UpdateParticipantInput, 'workshop_id'>)[] = [
    'full_name',
    'email',
    'phone',
    'person_id',
    'job_position',
  ];

  for (const field of fields) {
    if (input[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(input[field] || null);
    }
  }

  if (input.workshop_id !== undefined && input.workshop_id !== existing.workshop_id) {
    updates.push('workshop_id = ?');
    params.push(input.workshop_id);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  params.push(participantId, userId);
  await pool.execute(
    `UPDATE participants SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
    params as (string | number | null)[]
  );

  if (
    input.workshop_id !== undefined &&
    input.workshop_id !== existing.workshop_id &&
    input.workshop_id !== null &&
    existing.invoice_id
  ) {
    const newWorkshop = await queryOne<{ price: number }>(
      `SELECT price FROM workshops WHERE id = ?`,
      [input.workshop_id]
    );
    const targetCountRow = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM participants
       WHERE user_id = ? AND workshop_id = ? AND status != 'cancelled' AND id != ?`,
      [userId, input.workshop_id, participantId]
    );
    const amount = participantPriceAtPosition(
      Number(newWorkshop?.price || 0),
      (targetCountRow?.count || 0) + 1,
      userRole
    );
    const vatAmount = Math.round(amount * 0.05 * 100) / 100;
    const totalAmount = Math.round((amount + vatAmount) * 100) / 100;

    // Task 12: Retain the same invoice number unless the month changes.
    const existingInvoice = await queryOne<{ created_at: string }>(
      `SELECT created_at FROM invoices WHERE id = ?`,
      [existing.invoice_id]
    );
    const originalMonth = existingInvoice ? new Date(existingInvoice.created_at).getMonth() : null;
    const originalYear = existingInvoice ? new Date(existingInvoice.created_at).getFullYear() : null;
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthChanged = originalMonth !== currentMonth || originalYear !== currentYear;

    if (monthChanged) {
      const { generateInvoiceNumber } = await import('./orderReference.js');
      const newInvoiceNumber = await generateInvoiceNumber();
      const newInvoiceId = await insert(
        `INSERT INTO invoices (invoice_number, user_id, workshop_id, participant_id, amount, vat_amount, total_amount, status, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', NOW())`,
        [newInvoiceNumber, userId, input.workshop_id, participantId, amount, vatAmount, totalAmount]
      );
      await pool.execute(
        `UPDATE participants SET invoice_id = ? WHERE id = ?`,
        [newInvoiceId, participantId]
      );
    } else {
      await pool.execute(
        `UPDATE invoices SET workshop_id = ?, amount = ?, vat_amount = ?, total_amount = ? WHERE id = ?`,
        [input.workshop_id, amount, vatAmount, totalAmount, existing.invoice_id]
      );
    }
  }
}

export async function bulkCancelParticipants(userId: number, ids: number[]) {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniqueIds.length === 0) {
    throw new Error('No participants selected');
  }

  const placeholders = uniqueIds.map(() => '?').join(',');

  // Task 12: Enforce 24-hour cancellation lock
  const activeWorkshops = await query<{ start_date: string }>(
    `SELECT DISTINCT w.start_date FROM participants p
     JOIN workshops w ON w.id = p.workshop_id
     WHERE p.user_id = ? AND p.id IN (${placeholders})`,
    [userId, ...uniqueIds]
  );
  
  for (const w of activeWorkshops) {
    const start = new Date(w.start_date);
    const hoursDiff = (start.getTime() - Date.now()) / (3600 * 1000);
    if (hoursDiff < 24) {
      throw new Error('Cannot cancel/archive registrations within 24 hours of the workshop start time.');
    }
  }

  const [result] = await pool.execute(
    `UPDATE participants SET status = 'cancelled', archived_at = NOW()
     WHERE user_id = ? AND id IN (${placeholders}) AND status != 'cancelled'`,
    [userId, ...uniqueIds]
  );

  return (result as { affectedRows: number }).affectedRows;
}

export async function listArchivedParticipants(userId: number) {
  return query(
    `SELECT p.*, w.title as workshop_title, w.start_date, w.end_date, w.time_slot
     FROM participants p
     LEFT JOIN workshops w ON w.id = p.workshop_id
     WHERE p.user_id = ?
       AND p.status = 'cancelled'
       AND NOT EXISTS (
         SELECT 1 FROM participants active
         WHERE active.user_id = p.user_id
           AND LOWER(active.email) = LOWER(p.email)
           AND active.status != 'cancelled'
       )
     ORDER BY COALESCE(p.archived_at, p.created_at) DESC`,
    [userId]
  );
}

export async function restoreParticipants(userId: number, userRole: string, ids: number[]) {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniqueIds.length === 0) {
    throw new Error('No participants selected');
  }

  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = await query<{
    id: number;
    workshop_id: number | null;
    email: string;
  }>(
    `SELECT id, workshop_id, email
     FROM participants
     WHERE user_id = ? AND id IN (${placeholders}) AND status = 'cancelled'`,
    [userId, ...uniqueIds]
  );

  if (rows.length === 0) {
    throw new Error('No archived participants found');
  }

  let restored = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      if (row.workshop_id === null) {
        const dup = await queryOne(
          `SELECT id FROM participants
           WHERE user_id = ? AND workshop_id IS NULL AND LOWER(email) = LOWER(?) AND status != 'cancelled'`,
          [userId, row.email]
        );
        if (dup) {
          errors.push(`${row.email} is already active in your roster`);
          continue;
        }
      } else {
        const dup = await queryOne(
          `SELECT id FROM participants
           WHERE user_id = ? AND workshop_id = ? AND LOWER(email) = LOWER(?) AND status != 'cancelled'`,
          [userId, row.workshop_id, row.email]
        );
        if (dup) {
          errors.push(`${row.email} is already enrolled in this workshop`);
          continue;
        }

        if (userRole === 'cto' || userRole === 'cma') {
          const workshop = await queryOne<{ cto_cma_limit: number; cma_limit: number | null; hct_limit: number | null }>(
            `SELECT cto_cma_limit, cma_limit, hct_limit FROM workshops WHERE id = ?`,
            [row.workshop_id]
          );
          const countRow = await queryOne<{ count: number }>(
            `SELECT COUNT(*) as count FROM participants
             WHERE user_id = ? AND workshop_id = ? AND status != 'cancelled'`,
            [userId, row.workshop_id]
          );
          const limit = userRole === 'cto'
            ? (workshop?.hct_limit !== null ? workshop?.hct_limit ?? 3 : (workshop?.cto_cma_limit ?? 3))
            : (workshop?.cma_limit !== null ? workshop?.cma_limit ?? 3 : (workshop?.cto_cma_limit ?? 3));
          if ((countRow?.count || 0) >= limit) {
            errors.push(`Registration limit reached for workshop enrollment (${row.email})`);
            continue;
          }
        }

        await assertWorkshopSeatsAvailable(row.workshop_id);
      }

      const [result] = await pool.execute(
        `UPDATE participants SET status = 'confirmed', archived_at = NULL WHERE id = ? AND user_id = ?`,
        [row.id, userId]
      );
      if ((result as { affectedRows: number }).affectedRows) {
        restored += 1;
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `Failed to restore ${row.email}`);
    }
  }

  if (restored === 0) {
    throw new Error(errors[0] || 'Failed to restore participants');
  }

  return { restored, errors };
}

export interface ParticipantRosterEntry {
  person_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  job_position: string | null;
  enrolled_in_workshop: boolean;
}

export async function listParticipantRoster(
  userId: number,
  workshopId?: number
): Promise<ParticipantRosterEntry[]> {
  const params: unknown[] = [userId];
  let enrolledSelect = '0 AS enrolled_in_workshop';
  let enrolledJoin = '';

  if (workshopId) {
    enrolledSelect = 'CASE WHEN enrolled.id IS NOT NULL THEN 1 ELSE 0 END AS enrolled_in_workshop';
    enrolledJoin = `
      LEFT JOIN participants enrolled ON enrolled.user_id = ?
        AND enrolled.workshop_id = ?
        AND LOWER(enrolled.email) = LOWER(p.email)
        AND enrolled.status != 'cancelled'`;
    params.push(userId, workshopId);
  }

  params.push(userId);

  const sql = `
    SELECT
      p.person_id,
      p.full_name,
      p.email,
      p.phone,
      p.job_position,
      ${enrolledSelect}
    FROM participants p
    INNER JOIN (
      SELECT MAX(id) AS id
      FROM participants
      WHERE user_id = ? AND status != 'cancelled'
      GROUP BY LOWER(email)
    ) latest ON latest.id = p.id
    ${enrolledJoin}
    WHERE p.user_id = ?
    ORDER BY p.full_name ASC`;

  const rows = await query<{
    person_id: string | null;
    full_name: string;
    email: string;
    phone: string | null;
    job_position: string | null;
    enrolled_in_workshop: number;
  }>(sql, params);

  return rows.map((row) => ({
    person_id: row.person_id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    job_position: row.job_position,
    enrolled_in_workshop: row.enrolled_in_workshop === 1,
  }));
}

export type PaymentMethod = 'bank_transfer' | 'online';

export interface WorkshopRegistrationInput {
  workshop_id: number;
  participants: AddParticipantInput[];
  payment_method: PaymentMethod;
  terms_accepted: boolean;
}

export interface WorkshopRegistrationResult {
  message: string;
  workshop_id: number;
  workshop_title: string;
  payment_method: PaymentMethod;
  participant_count: number;
  unit_price: number;
  subtotal: number;
  vat: number;
  total: number;
  participant_ids: number[];
  failed: { email: string; error: string }[];
  order_id: string;
  order_status: 'pending' | 'paid' | 'confirmed';
  created_at: string;
  workshop: {
    start_date: string;
    end_date: string;
    time_slot: string;
    format: string;
    cpd_hours: number;
  };
  participants: {
    id: number;
    full_name: string;
    email: string;
    phone: string | null;
    person_id: string | null;
    job_position: string | null;
    invoice_number: string | null;
    invoice_status: string | null;
    total_amount: number | null;
  }[];
}

export async function registerWorkshopBooking(
  user: PortalUser,
  input: WorkshopRegistrationInput
): Promise<WorkshopRegistrationResult> {
  if (!input.terms_accepted) {
    throw new Error('You must accept the terms and conditions');
  }

  if (!input.participants.length) {
    throw new Error('Select at least one participant to enroll');
  }

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
     FROM workshops WHERE id = ? AND is_published = 1 AND end_date >= CURDATE()`,
    [input.workshop_id]
  );

  if (!workshop) {
    throw new Error('Workshop not found or no longer available');
  }

  const existingCount = await getParticipantCountForWorkshop(user.id, input.workshop_id);
  const participantIds: number[] = [];
  const failed: { email: string; error: string }[] = [];

  for (const participant of input.participants) {
    try {
      const id = await addParticipant(user, {
        ...participant,
        workshop_id: input.workshop_id,
      });
      participantIds.push(id);
    } catch (err) {
      failed.push({
        email: participant.email,
        error: err instanceof Error ? err.message : 'Registration failed',
      });
    }
  }

  if (participantIds.length === 0) {
    throw new Error(failed[0]?.error || 'Failed to register participants');
  }

  const unitPrice =
    user.role === 'cto' || user.role === 'cma' ? 0 : Number(workshop.price);
  const subtotal = calculateEnrollmentSubtotal(
    unitPrice,
    existingCount,
    participantIds.length,
    user.role
  );
  const vat = Math.round(subtotal * 0.05 * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;

  const placeholders = participantIds.map(() => '?').join(',');
  const enrolledRows = await query<{
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

  const orderId = formatOrderId(participantIds[0]);

  let orderStatus: 'pending' | 'paid' | 'confirmed' = 'confirmed';
  if (enrolledRows.some((row) => row.invoice_status === 'paid')) {
    orderStatus = 'paid';
  } else if (enrolledRows.some((row) => row.invoice_status === 'sent' || row.invoice_status === 'draft')) {
    orderStatus = 'pending';
  } else if (input.payment_method === 'bank_transfer' && total > 0) {
    orderStatus = 'pending';
  }

  return {
    message: `${participantIds.length} participant(s) registered successfully`,
    workshop_id: workshop.id,
    workshop_title: workshop.title,
    payment_method: input.payment_method,
    participant_count: participantIds.length,
    unit_price: unitPrice,
    subtotal,
    vat,
    total,
    participant_ids: participantIds,
    failed,
    order_id: orderId,
    order_status: orderStatus,
    created_at: enrolledRows[0]?.created_at || new Date().toISOString(),
    workshop: {
      start_date: String(workshop.start_date),
      end_date: String(workshop.end_date),
      time_slot: workshop.time_slot,
      format: workshop.format,
      cpd_hours: workshop.cpd_hours,
    },
    participants: enrolledRows.map((row) => ({
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
