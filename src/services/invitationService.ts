import { pool, query, queryOne } from '../db/pool.js';
import { sendEmail } from './emailService.js';
import {
  invitationEmailHtml,
  resolveInvitationBannerUrl,
  type InvitationEmailData,
} from './invitationEmailTemplate.js';

export interface WorkshopInvitationRow {
  id: number;
  title: string;
  description: string | null;
  category: string;
  cpd_hours: number;
  start_date: string;
  end_date: string;
  time_slot: string;
  zoom_link: string | null;
  invitation_program_label: string | null;
  invitation_subtitle: string | null;
  meeting_id: string | null;
  meeting_passcode: string | null;
  training_materials_url: string | null;
  pre_assessment_url: string | null;
  post_assessment_url: string | null;
  invitation_banner_url: string | null;
}

export function buildInvitationData(
  workshop: WorkshopInvitationRow,
  participantName?: string
): InvitationEmailData {
  return {
    participantName,
    programLabel: workshop.invitation_program_label || 'Online CPD Program',
    workshopTitle: workshop.title,
    subtitle: workshop.invitation_subtitle || workshop.description || '',
    startDate: String(workshop.start_date).slice(0, 10),
    endDate: String(workshop.end_date).slice(0, 10),
    timeSlot: workshop.time_slot,
    meetingLink: workshop.zoom_link,
    meetingId: workshop.meeting_id,
    meetingPasscode: workshop.meeting_passcode,
    trainingMaterialsUrl: workshop.training_materials_url,
    preAssessmentUrl: workshop.pre_assessment_url,
    postAssessmentUrl: workshop.post_assessment_url,
    bannerUrl: resolveInvitationBannerUrl(workshop.category, workshop.cpd_hours),
  };
}

export async function getWorkshopForInvitation(workshopId: number) {
  return queryOne<WorkshopInvitationRow>(
    `SELECT id, title, description, category, cpd_hours, start_date, end_date, time_slot, zoom_link,
            invitation_program_label, invitation_subtitle, meeting_id, meeting_passcode,
            training_materials_url, pre_assessment_url, post_assessment_url, invitation_banner_url
     FROM workshops WHERE id = ?`,
    [workshopId]
  );
}

export async function previewInvitation(workshopId: number, participantName?: string) {
  const workshop = await getWorkshopForInvitation(workshopId);
  if (!workshop) return null;
  return invitationEmailHtml(buildInvitationData(workshop, participantName));
}

export async function sendWorkshopInvitations(
  workshopId: number,
  participantIds?: number[]
): Promise<{ sent: number; failed: number }> {
  const workshop = await getWorkshopForInvitation(workshopId);
  if (!workshop) {
    throw new Error('Workshop not found');
  }

  let sql = `
    SELECT p.id, p.full_name, p.email
    FROM participants p
    WHERE p.workshop_id = ? AND p.status = 'confirmed'
  `;
  const params: unknown[] = [workshopId];

  if (participantIds?.length) {
    sql += ` AND p.id IN (${participantIds.map(() => '?').join(',')})`;
    params.push(...participantIds);
  }

  const participants = await query<{ id: number; full_name: string; email: string }>(sql, params);

  let sent = 0;
  let failed = 0;

  for (const participant of participants) {
    const html = invitationEmailHtml(buildInvitationData(workshop, participant.full_name));
    const ok = await sendEmail({
      to: participant.email,
      subject: `UASA Training Invitation — ${workshop.title}`,
      html,
      templateType: 'invitation',
      participantId: participant.id,
    });

    if (ok) {
      await pool.execute(`UPDATE participants SET invitation_sent = 1 WHERE id = ?`, [participant.id]);
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed };
}
