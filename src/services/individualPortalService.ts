import { pool, query, queryOne } from '../db/pool.js';
import {
  publishedWorkshopsWithSeatsFrom,
  publishedWorkshopsWithSeatsSelect,
} from './workshopSeatsService.js';

export const INDIVIDUAL_SYSTEM_USER_EMAIL = 'individual-registrations@uasatraining.internal';

export async function getSystemUserId(): Promise<number | null> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE email = ?`,
    [INDIVIDUAL_SYSTEM_USER_EMAIL]
  );
  return row?.id ?? null;
}

/** Reassign legacy participant/invoice records from the system user to the individual account. */
export async function migrateIndividualRecords(userId: number, email: string): Promise<void> {
  const systemUserId = await getSystemUserId();
  if (!systemUserId) return;

  const normalizedEmail = email.trim().toLowerCase();

  await pool.execute(
    `UPDATE participants SET user_id = ? WHERE user_id = ? AND LOWER(email) = ?`,
    [userId, systemUserId, normalizedEmail]
  );

  await pool.execute(
    `UPDATE invoices i
     JOIN participants p ON p.invoice_id = i.id
     SET i.user_id = ?
     WHERE i.user_id = ? AND LOWER(p.email) = ?`,
    [userId, systemUserId, normalizedEmail]
  );
}

function participantFilter(userId: number, email: string): { clause: string; params: unknown[] } {
  return {
    clause: `(p.user_id = ? OR (LOWER(p.email) = ? AND p.user_id = (SELECT id FROM users WHERE email = ? LIMIT 1)))`,
    params: [userId, email.trim().toLowerCase(), INDIVIDUAL_SYSTEM_USER_EMAIL],
  };
}

export type IndividualParticipantRecord = {
  id: number;
  user_id: number;
  workshop_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  person_id: string | null;
  job_position: string | null;
  status: string;
  attended: number;
  attendance_status: string | null;
  post_exam_status: string | null;
  cpd_status: string | null;
  certificate_sent: number;
  invoice_id: number | null;
  created_at: string;
  workshop_title: string | null;
  start_date: string | null;
  end_date: string | null;
  time_slot: string | null;
  format: string | null;
  cpd_hours: number | null;
  price: number | null;
  invoice_number: string | null;
  invoice_total: number | null;
  invoice_status: string | null;
};

export type IndividualWorkshopRecord = {
  id: number;
  title: string;
  start_date: string;
  end_date: string;
  [key: string]: unknown;
};

export async function listIndividualParticipants(
  userId: number,
  email: string
): Promise<IndividualParticipantRecord[]> {
  const { clause, params } = participantFilter(userId, email);
  return query(
    `SELECT
       p.id,
       p.user_id,
       p.workshop_id,
       p.full_name,
       p.email,
       p.phone,
       p.person_id,
       p.job_position,
       p.status,
       p.attended,
       p.attendance_status,
       p.post_exam_status,
       p.cpd_status,
       p.certificate_sent,
       p.invoice_id,
       p.created_at,
       w.title AS workshop_title,
       w.start_date,
       w.end_date,
       w.time_slot,
       w.format,
       w.cpd_hours,
       w.price,
       i.invoice_number,
       i.total_amount AS invoice_total,
       i.status AS invoice_status
     FROM participants p
     LEFT JOIN workshops w ON w.id = p.workshop_id
     LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE ${clause} AND p.status != 'cancelled'
     ORDER BY p.created_at DESC`,
    params
  ) as Promise<IndividualParticipantRecord[]>;
}

export async function getIndividualParticipant(
  participantId: number,
  userId: number,
  email: string
): Promise<(IndividualParticipantRecord & { workshop_price?: number }) | null> {
  const { clause, params } = participantFilter(userId, email);
  return queryOne<IndividualParticipantRecord & { workshop_price?: number }>(
    `SELECT p.*, w.title AS workshop_title, w.start_date, w.end_date, w.time_slot, w.format, w.price AS workshop_price
     FROM participants p
     JOIN workshops w ON w.id = p.workshop_id
     WHERE p.id = ? AND ${clause} AND p.status != 'cancelled'`,
    [participantId, ...params]
  );
}

export async function listIndividualWorkshops(
  userId: number,
  email: string
): Promise<IndividualWorkshopRecord[]> {
  const { clause, params } = participantFilter(userId, email);
  return query(
    `SELECT DISTINCT
       w.id,
       w.title,
       w.title_2,
       w.category,
       w.cpd_hours,
       w.start_date,
       w.end_date,
       w.time_slot,
       w.language,
       w.format,
       w.image_url,
       w.description,
       w.price,
       w.total_seats,
       w.is_published,
       w.registration_open,
       w.zoom_link,
       w.meeting_id,
       w.meeting_passcode,
       w.training_materials_url,
       w.pre_assessment_url,
       w.post_assessment_url,
       w.created_at,
       p.id AS participant_id,
       p.status AS participant_status,
       p.attendance_status,
       p.attended,
       p.certificate_sent,
       p.invoice_id,
       i.invoice_number,
       i.status AS invoice_status,
       i.total_amount AS invoice_total
     FROM participants p
     JOIN workshops w ON w.id = p.workshop_id
     LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE ${clause} AND p.status != 'cancelled'
     ORDER BY w.start_date DESC`,
    params
  ) as Promise<IndividualWorkshopRecord[]>;
}

export async function isIndividualEnrolledInWorkshop(
  userId: number,
  email: string,
  workshopId: number
): Promise<boolean> {
  const { clause, params } = participantFilter(userId, email);
  const row = await queryOne<{ id: number }>(
    `SELECT p.id FROM participants p
     WHERE p.workshop_id = ? AND ${clause} AND p.status != 'cancelled'
     LIMIT 1`,
    [workshopId, ...params]
  );
  return !!row;
}

export async function listAvailableWorkshopsForIndividual(userId: number, email: string) {
  const { clause, params } = participantFilter(userId, email);
  return query(
    `SELECT ${publishedWorkshopsWithSeatsSelect}
     FROM ${publishedWorkshopsWithSeatsFrom}
     WHERE w.is_published = 1
       AND w.end_date >= CURDATE()
       AND (w.registration_open IS NULL OR w.registration_open = 1)
       AND w.id NOT IN (
         SELECT p.workshop_id FROM participants p
         WHERE ${clause} AND p.status != 'cancelled'
       )
     ORDER BY w.start_date ASC`,
    params
  );
}

export async function getIndividualRegistrationDefaults(userId: number, email: string) {
  const { clause, params } = participantFilter(userId, email);
  const fromParticipant = await queryOne<{
    phone: string | null;
    person_id: string | null;
    job_position: string | null;
    company: string | null;
  }>(
    `SELECT p.phone, p.person_id, p.job_position, NULL AS company
     FROM participants p
     WHERE ${clause}
     ORDER BY p.created_at DESC
     LIMIT 1`,
    params
  );
  if (fromParticipant?.phone || fromParticipant?.person_id) {
    return fromParticipant;
  }

  const normalized = email.trim().toLowerCase();
  return queryOne<{
    phone: string | null;
    person_id: string | null;
    job_position: string | null;
    company: string | null;
  }>(
    `SELECT phone, person_id, job_position, company
     FROM registrations
     WHERE registration_type = 'Individual' AND LOWER(email) = ? AND status != 'cancelled'
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalized]
  );
}

export async function getIndividualDashboardStats(userId: number, email: string) {
  const { clause, params } = participantFilter(userId, email);

  const stats = await queryOne<{
    total_workshops: number;
    attended: number;
    pending_invoices: number;
    certificates_available: number;
  }>(
    `SELECT
       COUNT(DISTINCT p.workshop_id) AS total_workshops,
       SUM(CASE WHEN p.attendance_status = 'present' OR p.attended = 1 THEN 1 ELSE 0 END) AS attended,
       SUM(CASE WHEN i.status IN ('draft', 'sent') THEN 1 ELSE 0 END) AS pending_invoices,
       SUM(CASE WHEN (p.attendance_status = 'present' OR p.attended = 1) THEN 1 ELSE 0 END) AS certificates_available
     FROM participants p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE ${clause} AND p.status != 'cancelled'`,
    params
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const workshops = await listIndividualWorkshops(userId, email);

  let upcoming = 0;
  let ongoing = 0;
  let past = 0;

  for (const w of workshops) {
    const start = new Date(String(w.start_date).slice(0, 10));
    const end = new Date(String(w.end_date).slice(0, 10));
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    if (end < today) past++;
    else if (start > today) upcoming++;
    else ongoing++;
  }

  return {
    total_workshops: Number(stats?.total_workshops) || 0,
    total_attendance: Number(stats?.attended) || 0,
    pending_invoices: Number(stats?.pending_invoices) || 0,
    certificates_available: Number(stats?.certificates_available) || 0,
    upcoming_workshops: upcoming,
    ongoing_workshops: ongoing,
    past_workshops: past,
  };
}

export async function emailHasIndividualRecords(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const reg = await queryOne<{ id: number }>(
    `SELECT id FROM registrations
     WHERE registration_type = 'Individual' AND LOWER(email) = ? AND status != 'cancelled'
     LIMIT 1`,
    [normalized]
  );
  if (reg) return true;

  const systemUserId = await getSystemUserId();
  if (!systemUserId) return false;

  const participant = await queryOne<{ id: number }>(
    `SELECT id FROM participants
     WHERE user_id = ? AND LOWER(email) = ? AND status != 'cancelled'
     LIMIT 1`,
    [systemUserId, normalized]
  );
  return !!participant;
}
