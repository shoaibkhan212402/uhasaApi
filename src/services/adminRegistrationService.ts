import { insert, queryOne } from '../db/pool.js';

export interface AdminRegistrationImportRow {
  full_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  coordinator_name?: string;
  company_phone?: string;
  company_address?: string;
  company_trn?: string;
  job_position?: string;
  person_id?: string;
  workshop_id?: string;
  workshop_title?: string;
  registration_type?: string;
  total_seats?: string;
  total_amount?: string;
  status?: string;
  [key: string]: string | undefined;
}

function pick(row: AdminRegistrationImportRow, ...keys: string[]): string {
  const record = row as Record<string, string | undefined>;
  for (const key of keys) {
    const val = record[key]?.trim();
    if (val) return val;
  }
  return '';
}

function isHeaderLikeRow(row: AdminRegistrationImportRow): boolean {
  const orderId = pick(row, 'order_id', 'Order Id', 'orderId');
  const name = pick(row, 'full_name', 'Name', 'Full Name');
  const email = pick(row, 'email', 'Email');
  if (orderId.toLowerCase() === 'order id') return true;
  if (name.toLowerCase() === 'name' && email.toLowerCase() === 'email') return true;
  return false;
}

function normalizeStatus(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (['pending', 'confirmed', 'cancelled'].includes(normalized)) return normalized;
  if (normalized === 'paid' || normalized === 'approve') {
    return normalized === 'paid' ? 'confirmed' : 'pending';
  }
  return 'pending';
}

function normalizeRegistrationType(value: string, fallback?: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'individual') return 'Individual';
  if (normalized === 'corporate') return 'Corporate';
  if (normalized === 'bank') return 'Bank';
  return fallback || 'Individual';
}

async function resolveWorkshopId(row: AdminRegistrationImportRow): Promise<number | null> {
  const workshopIdRaw = pick(row, 'workshop_id', 'Workshop ID');
  if (workshopIdRaw) {
    const id = parseInt(workshopIdRaw, 10);
    if (Number.isFinite(id) && id > 0) return id;
  }

  const workshopTitle = pick(row, 'workshop_title', 'Workshop', 'Workshop Title');
  if (!workshopTitle) return null;

  const workshop = await queryOne<{ id: number }>(
    `SELECT id FROM workshops WHERE title = ? LIMIT 1`,
    [workshopTitle]
  );
  return workshop?.id ?? null;
}

export async function adminImportRegistrations(
  rows: AdminRegistrationImportRow[],
  defaultType?: string,
  createdBy?: number
) {
  const result = { added: 0, failed: [] as string[] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    if (isHeaderLikeRow(row)) continue;

    const full_name = pick(row, 'full_name', 'Name', 'Full Name');
    const email = pick(row, 'email', 'Email');
    const phone = pick(row, 'phone', 'Contact No', 'Phone', 'Mobile Number');
    const company = pick(row, 'company', 'Company Name', 'Company');
    const coordinator_name = pick(row, 'coordinator_name', 'Coordinator Name');
    const company_phone = pick(row, 'company_phone', 'Company Phone');
    const company_address = pick(row, 'company_address', 'Company Address');
    const company_trn = pick(row, 'company_trn', 'Company TRN');
    const job_position = pick(row, 'job_position', 'Job Position');
    const person_id = pick(row, 'person_id', 'Person ID');
    const registration_type = normalizeRegistrationType(
      pick(row, 'registration_type', 'User Type', 'Type'),
      defaultType
    );
    const total_seats = parseInt(pick(row, 'total_seats', 'No Of Participants', 'Seats'), 10) || 1;
    const total_amountRaw = pick(row, 'total_amount', 'Total Amount', 'Amount');
    const total_amount = total_amountRaw ? parseFloat(total_amountRaw) : null;
    const invoice_number = pick(row, 'invoice_number', 'Invoice No', 'Invoice Number');
    const status = normalizeStatus(
      pick(row, 'status', 'Status', 'Action') || 'pending'
    );

    if (!full_name || !email) {
      result.failed.push(`Row ${rowNum}: Name and Email are required`);
      continue;
    }

    const workshop_id = await resolveWorkshopId(row);

    try {
      await insert(
        `INSERT INTO registrations (
          workshop_id, registration_type, person_id, full_name, coordinator_name,
          job_position, email, phone, company, company_address, company_phone, company_trn,
          total_seats, terms_accepted, total_amount, invoice_number, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          workshop_id,
          registration_type,
          person_id || null,
          full_name,
          coordinator_name || null,
          job_position || null,
          email,
          phone || null,
          company || null,
          company_address || null,
          company_phone || null,
          company_trn || null,
          total_seats,
          total_amount,
          invoice_number || null,
          status,
          createdBy || null,
        ]
      );
      result.added++;
    } catch (err) {
      result.failed.push(
        `Row ${rowNum}: ${err instanceof Error ? err.message : 'Import failed'}`
      );
    }
  }

  return result;
}
