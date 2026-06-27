import { insert, queryOne } from '../db/pool.js';

export interface AdminParticipantImportRow {
  person_id?: string;
  full_name?: string;
  job_position?: string;
  email?: string;
  phone?: string;
  workshop_id?: string;
  workshop_title?: string;
  user_email?: string;
  organization_email?: string;
  status?: string;
  attended?: string;
  attendance_status?: string;
  post_exam_status?: string;
  cpd_status?: string;
  [key: string]: string | undefined;
}

function pick(row: AdminParticipantImportRow, ...keys: string[]): string {
  const record = row as Record<string, string | undefined>;
  for (const key of keys) {
    const val = record[key]?.trim();
    if (val) return val;
  }
  return '';
}

function normalizeAttendanceStatus(attendanceRaw: string, attendedRaw: string): string {
  const value = attendanceRaw.trim().toLowerCase().replace(/\s+/g, '_');
  if (['pending', 'present', 'absent'].includes(value)) return value;
  if (attendedRaw && ['1', 'true', 'yes', 'y'].includes(attendedRaw.toLowerCase())) return 'present';
  return 'pending';
}

function normalizePostExamStatus(value: string): string {
  const normalized = value.toLowerCase().replace(/\s+/g, '_');
  if (['pending', 'passed', 'failed'].includes(normalized)) return normalized;
  return 'pending';
}

function normalizeCpdStatus(value: string): string {
  const normalized = value.toLowerCase().replace(/\s+/g, '_');
  if (['pending', 'credited', 'not_credited'].includes(normalized)) return normalized;
  if (normalized === 'notcredited') return 'not_credited';
  return 'pending';
}

export async function adminImportParticipants(rows: AdminParticipantImportRow[]) {
  const result = { added: 0, failed: [] as string[] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const person_id = pick(row, 'person_id', 'Person ID (as per CMA profile)', 'Person ID');
    const full_name = pick(row, 'full_name', 'Full Name');
    const job_position = pick(row, 'job_position', 'Job Position');
    const email = pick(row, 'email', 'Email Address', 'Email');
    const phone = pick(row, 'phone', 'Mobile Number', 'Mobile', 'Phone');
    const userEmail = pick(row, 'user_email', 'Organization Email', 'User Email', 'organization_email');
    const workshopIdRaw = pick(row, 'workshop_id', 'Workshop ID');
    const workshopTitle = pick(row, 'workshop_title', 'Workshop', 'Workshop Title');
    const status = pick(row, 'status', 'Status') || 'confirmed';
    const attendedRaw = pick(row, 'attended', 'Attended');
    const attendanceStatusRaw = pick(row, 'attendance_status', 'Attendance');
    const postExamStatusRaw = pick(row, 'post_exam_status', 'Post Exam');
    const cpdStatusRaw = pick(row, 'cpd_status', 'CPD Status');

    const attendanceStatus = normalizeAttendanceStatus(attendanceStatusRaw, attendedRaw);
    const postExamStatus = normalizePostExamStatus(postExamStatusRaw);
    const cpdStatus = normalizeCpdStatus(cpdStatusRaw);

    if (!full_name || !email) {
      result.failed.push(`Row ${rowNum}: Full Name and Email are required`);
      continue;
    }

    if (!userEmail) {
      result.failed.push(`Row ${rowNum}: Organization Email is required (e.g. corporate@demo.com)`);
      continue;
    }

    const user = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND role IN ('corporate', 'bank', 'cto', 'cma')`,
      [userEmail]
    );
    if (!user) {
      result.failed.push(`Row ${rowNum}: Organization user not found (${userEmail || 'missing email'})`);
      continue;
    }

    let workshopId = workshopIdRaw ? parseInt(workshopIdRaw, 10) : 0;
    if (!Number.isFinite(workshopId) || workshopId <= 0) {
      const workshop = workshopTitle
        ? await queryOne<{ id: number }>(`SELECT id FROM workshops WHERE title = ? LIMIT 1`, [workshopTitle])
        : null;
      workshopId = workshop?.id ?? 0;
    }

    if (!workshopId) {
      result.failed.push(`Row ${rowNum}: Workshop not found`);
      continue;
    }

    const existing = await queryOne(
      `SELECT id FROM participants WHERE user_id = ? AND workshop_id = ? AND email = ? AND status != 'cancelled'`,
      [user.id, workshopId, email]
    );
    if (existing) {
      result.failed.push(`Row ${rowNum}: Participant already exists for this workshop`);
      continue;
    }

    const validStatus = ['pending', 'confirmed', 'cancelled'].includes(status) ? status : 'confirmed';

    try {
      await insert(
        `INSERT INTO participants
           (user_id, workshop_id, full_name, email, phone, person_id, job_position, status, attended, attendance_status, post_exam_status, cpd_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          workshopId,
          full_name,
          email,
          phone || null,
          person_id || null,
          job_position || null,
          validStatus,
          attendanceStatus === 'present' ? 1 : 0,
          attendanceStatus,
          postExamStatus,
          cpdStatus,
        ]
      );
      result.added += 1;
    } catch (err) {
      result.failed.push(`Row ${rowNum}: ${err instanceof Error ? err.message : 'Insert failed'}`);
    }
  }

  return result;
}
