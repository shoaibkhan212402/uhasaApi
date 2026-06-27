import { insert, query, queryOne } from '../db/pool.js';

export interface CreateRegistrationInput {
  workshop_id: number;
  registration_type: 'Individual' | 'Corporate' | 'Bank';
  person_id?: string | null;
  full_name: string;
  coordinator_name?: string | null;
  username?: string | null;
  job_position?: string | null;
  email: string;
  phone?: string | null;
  company?: string | null;
  company_address?: string | null;
  company_phone?: string | null;
  company_trn?: string | null;
  total_seats?: number;
  terms_accepted?: boolean;
  total_amount?: number | null;
}

export async function createRegistration(input: CreateRegistrationInput): Promise<number> {
  const workshop = await queryOne<{ id: number; total_seats: number }>(
    `SELECT id, total_seats FROM workshops WHERE id = ? AND is_published = 1`,
    [input.workshop_id]
  );
  if (!workshop) throw new Error(`Workshop ${input.workshop_id} not found`);

  const seatRows = await query<{ total_seats: number | null }>(
    `SELECT total_seats FROM registrations WHERE workshop_id = ? AND status != 'cancelled'`,
    [input.workshop_id]
  );
  const portalSeats = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM participants WHERE workshop_id = ? AND status != 'cancelled'`,
    [input.workshop_id]
  );
  const registered =
    seatRows.reduce((sum, r) => sum + (r.total_seats || 1), 0) + (portalSeats?.count || 0);
  const requestedSeats = input.total_seats || 1;

  if (registered + requestedSeats > workshop.total_seats) {
    throw new Error(`Not enough seats available for workshop ${input.workshop_id}`);
  }

  return insert(
    `INSERT INTO registrations (
      workshop_id, registration_type, person_id, full_name, coordinator_name, username,
      job_position, email, phone, company, company_address, company_phone, company_trn,
      total_seats, terms_accepted, total_amount, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      input.workshop_id,
      input.registration_type,
      input.person_id || null,
      input.full_name,
      input.coordinator_name || null,
      input.username || null,
      input.job_position || null,
      input.email,
      input.phone || null,
      input.company || null,
      input.company_address || null,
      input.company_phone || null,
      input.company_trn || null,
      input.total_seats || 1,
      input.terms_accepted ? 1 : 0,
      input.total_amount ?? null,
    ]
  );
}
