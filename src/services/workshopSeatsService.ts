import { query } from '../db/pool.js';

const REGISTERED_SEATS_JOIN = `
  LEFT JOIN (
    SELECT workshop_id, SUM(COALESCE(total_seats, 1)) AS seats
    FROM registrations
    WHERE status != 'cancelled'
    GROUP BY workshop_id
  ) reg_seats ON reg_seats.workshop_id = w.id
  LEFT JOIN (
    SELECT workshop_id, COUNT(*) AS cnt
    FROM participants
    WHERE status != 'cancelled'
    GROUP BY workshop_id
  ) portal_seats ON portal_seats.workshop_id = w.id
`;

export async function listWorkshopSeatAvailability() {
  return query<{ workshop_id: number; registered_seats: number }>(
    `SELECT w.id AS workshop_id,
      COALESCE(reg_seats.seats, 0) + COALESCE(portal_seats.cnt, 0) AS registered_seats
     FROM workshops w
     ${REGISTERED_SEATS_JOIN}
     WHERE w.is_published = 1 AND w.end_date >= CURDATE()
     ORDER BY w.start_date ASC`
  );
}

export const publishedWorkshopsWithSeatsSelect = `w.*,
  COALESCE(reg_seats.seats, 0) + COALESCE(portal_seats.cnt, 0) AS registered_seats`;

export const publishedWorkshopsWithSeatsFrom = `workshops w
  ${REGISTERED_SEATS_JOIN}`;
