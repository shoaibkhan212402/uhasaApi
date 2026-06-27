import { pool, query, queryOne } from '../db/pool.js';
import { sendEmail } from './emailService.js';
import {
  CERTIFICATE_EMAIL_HERO_FILE,
  CMA_LOGO_FILE,
  logoDataUri,
  sanitizeFilename,
  UASA_LOGO_FILE,
} from './certificateAssets.js';
import { certificateDataToPdf } from './certificatePdfService.js';
import {
  buildReferenceNumber,
  certificateHtml,
  formatCertificateDates,
  type CertificateData,
} from './certificateTemplate.js';
import { certificateEmailHtml } from './certificateEmailTemplate.js';

export interface WorkshopCertificateRow {
  id: number;
  title: string;
  start_date: string;
  end_date: string;
  cpd_hours: number;
  certificate_note: string | null;
  invitation_program_label: string | null;
  invitation_subtitle: string | null;
}

export function buildCertificateData(
  workshop: WorkshopCertificateRow,
  participantName: string,
  assetsBaseUrl?: string
): CertificateData {
  return {
    participantName: participantName,
    workshopTitle: workshop.title,
    workshopDates: formatCertificateDates(String(workshop.start_date), String(workshop.end_date)),
    referenceNumber: buildReferenceNumber(workshop.title, String(workshop.start_date), String(workshop.end_date)),
    certificateNote: workshop.certificate_note,
    cpdHours: workshop.cpd_hours,
    programLabel: workshop.invitation_program_label || 'Online CPD Program',
    workshopSubtitle: workshop.invitation_subtitle,
    assetsBaseUrl,
  };
}

export async function getWorkshopForCertificate(workshopId: number) {
  return queryOne<WorkshopCertificateRow>(
    `SELECT id, title, start_date, end_date, cpd_hours, certificate_note,
            invitation_program_label, invitation_subtitle
     FROM workshops WHERE id = ?`,
    [workshopId]
  );
}

export function withEmbeddedLogos(data: CertificateData): CertificateData {
  return {
    ...data,
    uasaLogoUrl: logoDataUri(UASA_LOGO_FILE),
    cmaLogoUrl: logoDataUri(CMA_LOGO_FILE),
    emailHeroUrl: logoDataUri(CERTIFICATE_EMAIL_HERO_FILE),
  };
}

export function certificateFilename(workshop: WorkshopCertificateRow, participantName: string): string {
  const ref = buildReferenceNumber(
    workshop.title,
    String(workshop.start_date),
    String(workshop.end_date)
  );
  const name = sanitizeFilename(participantName);
  return `Certificate-${ref}-${name}.pdf`;
}

export async function previewCertificate(
  workshopId: number,
  participantName?: string,
  assetsBaseUrl?: string
) {
  const workshop = await getWorkshopForCertificate(workshopId);
  if (!workshop) return null;
  const name = participantName || 'PARTICIPANT NAME';
  return certificateHtml(withEmbeddedLogos(buildCertificateData(workshop, name, assetsBaseUrl)));
}

export async function generateCertificatePdf(
  workshopId: number,
  participantName?: string,
  assetsBaseUrl?: string
): Promise<{ pdf: Buffer; filename: string } | null> {
  const workshop = await getWorkshopForCertificate(workshopId);
  if (!workshop) return null;

  const name = participantName || 'PARTICIPANT NAME';
  const data = withEmbeddedLogos(buildCertificateData(workshop, name, assetsBaseUrl));
  const pdf = await certificateDataToPdf(data);

  return {
    pdf,
    filename: certificateFilename(workshop, name),
  };
}

export async function sendWorkshopCertificates(
  workshopId: number,
  participantIds?: number[],
  options?: { userId?: number; assetsBaseUrl?: string }
): Promise<{ sent: number; failed: number }> {
  const workshop = await getWorkshopForCertificate(workshopId);
  if (!workshop) {
    throw new Error('Workshop not found');
  }

  let sql = `
    SELECT p.id, p.full_name, p.email
    FROM participants p
    WHERE p.workshop_id = ? AND p.status = 'confirmed' AND p.attendance_status = 'present'
  `;
  const params: unknown[] = [workshopId];

  if (options?.userId) {
    sql += ` AND p.user_id = ?`;
    params.push(options.userId);
  }

  if (participantIds?.length) {
    sql += ` AND p.id IN (${participantIds.map(() => '?').join(',')})`;
    params.push(...participantIds);
  }

  const participants = await query<{ id: number; full_name: string; email: string }>(sql, params);

  if (!participants.length) {
    throw new Error('No attended participants found for this workshop');
  }

  let sent = 0;
  let failed = 0;

  for (const participant of participants) {
    const certData = buildCertificateData(workshop, participant.full_name, options?.assetsBaseUrl);
    const embedded = withEmbeddedLogos(certData);
    const pdf = await certificateDataToPdf(embedded);
    const filename = certificateFilename(workshop, participant.full_name);
    const html = certificateEmailHtml(embedded, true);
    const ok = await sendEmail({
      to: participant.email,
      subject: `Certificate of Participation — ${workshop.title}`,
      html,
      templateType: 'certificate',
      participantId: participant.id,
      attachments: [{ filename, content: pdf }],
    });

    if (ok) {
      await pool.execute(`UPDATE participants SET certificate_sent = 1 WHERE id = ?`, [participant.id]);
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed };
}
