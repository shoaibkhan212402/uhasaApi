import { query } from '../db/pool.js';

export const INVOICE_FROM = `
  FROM invoices i
  JOIN users u ON u.id = i.user_id
  LEFT JOIN workshops w ON w.id = i.workshop_id
  LEFT JOIN participants p ON p.id = i.participant_id
  LEFT JOIN registrations reg_invoice ON reg_invoice.id = i.registration_id
  LEFT JOIN banks b ON b.id = u.bank_id
  LEFT JOIN registrations reg
    ON reg.workshop_id = i.workshop_id
   AND reg.email = p.email
   AND reg.registration_type = 'Individual'
`;

export const INVOICE_SELECT = `
  SELECT i.id,
         i.invoice_number,
         COALESCE(i.participant_id, i.registration_id, i.id) AS order_id,
         CASE
           WHEN reg_invoice.id IS NOT NULL AND reg_invoice.invoice_type IS NOT NULL THEN reg_invoice.invoice_type
           WHEN u.role = 'bank' AND COALESCE(b.auto_invoice, 1) = 0 THEN 'Manual'
           WHEN i.sent_at IS NOT NULL THEN 'Automatic'
           ELSE 'Manual'
         END AS type,
         CASE
           WHEN reg_invoice.id IS NOT NULL THEN reg_invoice.registration_type
           WHEN reg.registration_type = 'Individual' THEN 'Individual'
           WHEN u.role = 'bank' THEN 'Bank'
           WHEN u.role = 'corporate' THEN 'Corporate'
           ELSE CONCAT(UPPER(LEFT(u.role, 1)), SUBSTRING(u.role, 2))
         END AS user_type,
         i.user_id,
         i.workshop_id,
         i.participant_id,
         i.registration_id,
         i.amount,
         i.vat_amount,
         i.total_amount,
         i.status,
         i.sent_at,
         i.created_at,
         u.name AS user_name,
         u.email AS user_email,
         u.role AS user_role,
         u.company AS user_company,
         b.name AS bank_name,
         COALESCE(p.full_name, reg_invoice.full_name) AS participant_name,
         COALESCE(p.email, reg_invoice.email) AS participant_email,
         COALESCE(p.phone, reg_invoice.phone) AS participant_phone,
         COALESCE(p.person_id, reg_invoice.person_id) AS participant_person_id,
         COALESCE(p.job_position, reg_invoice.job_position) AS participant_job_position,
         COALESCE(p.status, reg_invoice.status) AS participant_status,
         w.title AS workshop_title,
         w.start_date AS workshop_start_date,
         w.end_date AS workshop_end_date,
         w.time_slot AS workshop_time_slot,
         w.format AS workshop_format
`;

export function applyInvoiceFilters(
  sql: string,
  params: unknown[],
  queryParams: Record<string, unknown>
) {
  const { status, type, user_type, search } = queryParams;

  if (status) {
    sql += ` AND i.status = ?`;
    params.push(status);
  }

  if (type === 'Automatic' || type === 'Manual') {
    sql += ` AND (
      CASE
        WHEN reg_invoice.id IS NOT NULL AND reg_invoice.invoice_type IS NOT NULL THEN reg_invoice.invoice_type
        WHEN u.role = 'bank' AND COALESCE(b.auto_invoice, 1) = 0 THEN 'Manual'
        WHEN i.sent_at IS NOT NULL THEN 'Automatic'
        ELSE 'Manual'
      END
    ) COLLATE utf8mb4_unicode_ci = ?`;
    params.push(type);
  }

  if (user_type) {
    sql += ` AND (
      CASE
        WHEN reg_invoice.id IS NOT NULL THEN reg_invoice.registration_type
        WHEN reg.registration_type = 'Individual' THEN 'Individual'
        WHEN u.role = 'bank' THEN 'Bank'
        WHEN u.role = 'corporate' THEN 'Corporate'
        ELSE CONCAT(UPPER(LEFT(u.role, 1)), SUBSTRING(u.role, 2))
      END
    ) COLLATE utf8mb4_unicode_ci = ?`;
    params.push(user_type);
  }

  if (search) {
    const term = `%${String(search).trim()}%`;
    sql += ` AND (
      i.invoice_number LIKE ?
      OR CAST(COALESCE(i.participant_id, i.registration_id, i.id) AS CHAR) LIKE ?
      OR CAST(i.id AS CHAR) LIKE ?
      OR COALESCE(p.full_name, reg_invoice.full_name) LIKE ?
      OR COALESCE(p.email, reg_invoice.email) LIKE ?
      OR u.email LIKE ?
      OR u.name LIKE ?
      OR u.company LIKE ?
      OR b.name LIKE ?
      OR w.title LIKE ?
      OR reg_invoice.company LIKE ?
    )`;
    params.push(term, term, term, term, term, term, term, term, term, term, term);
  }

  return sql;
}

export function buildInvoiceListQuery(queryParams: Record<string, unknown>, currentUser?: { role: string; id: number }) {
  let sql = `${INVOICE_SELECT} ${INVOICE_FROM} WHERE 1=1`;
  const params: unknown[] = [];
  sql = applyInvoiceFilters(sql, params, queryParams);
  if (currentUser?.role === 'coordinator') {
    sql += ` AND (u.created_by = ? OR reg_invoice.created_by = ?)`;
    params.push(currentUser.id, currentUser.id);
  }
  sql += ` ORDER BY i.id DESC`;
  return { sql, params };
}

export async function fetchInvoicesForExport(queryParams: Record<string, unknown>, currentUser?: { role: string; id: number }) {
  const { sql, params } = buildInvoiceListQuery(queryParams, currentUser);
  return query(sql, params);
}
