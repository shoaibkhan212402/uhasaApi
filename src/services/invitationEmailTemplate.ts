const LOGO_URL =
  'https://mcusercontent.com/0a756f44b6fd1328c8eaaaeed/images/30f642a2-83c7-d3c5-d69c-08e8482e9661.png';
const QR_PLACEHOLDER_URL =
  'https://mcusercontent.com/0a756f44b6fd1328c8eaaaeed/images/47c01b8d-6906-4107-a2eb-ca9e2b1297b9.png';

export const AML_WORKSHOP_CATEGORY = 'AML / Cybersecurity / Securities Innovation';

/** Banner images from docs/invite sample *.html — selected by workshop type + CPD hours. */
const INVITATION_BANNERS = {
  aml05: 'https://mcusercontent.com/0a756f44b6fd1328c8eaaaeed/images/e4ee04da-b766-b578-a95f-d1bf245aa701.png',
  general05: 'https://mcusercontent.com/0a756f44b6fd1328c8eaaaeed/images/05abcf68-a028-7332-28b0-1a1012d51ae8.png',
  general10: 'https://mcusercontent.com/0a756f44b6fd1328c8eaaaeed/images/e932d3c5-fa4a-d771-f5c4-e0a7921788c9.png',
  general15: 'https://mcusercontent.com/0a756f44b6fd1328c8eaaaeed/images/a29beffa-8092-cc00-2c22-9c410a9221a8.png',
} as const;

export type InvitationTemplateKey = keyof typeof INVITATION_BANNERS;

export function resolveInvitationTemplateKey(
  category: string,
  cpdHours: number
): InvitationTemplateKey {
  const isAml = category === AML_WORKSHOP_CATEGORY;

  if (isAml && cpdHours === 5) return 'aml05';
  if (!isAml && cpdHours === 5) return 'general05';
  if (!isAml && cpdHours === 10) return 'general10';
  if (!isAml && cpdHours === 15) return 'general15';

  const typeLabel = isAml ? 'AML / Cybersecurity / Securities Innovation' : 'Other Topics';
  throw new Error(
    `No invitation template for workshop type "${typeLabel}" with ${cpdHours} CPD hours. ` +
      'Supported combinations: AML + 5 CPD, or Other Topics + 5/10/15 CPD.'
  );
}

export function resolveInvitationBannerUrl(category: string, cpdHours: number): string {
  return INVITATION_BANNERS[resolveInvitationTemplateKey(category, cpdHours)];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseDate(value: string): Date {
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date(value) : d;
}

export function formatInvitationDateRange(startDate: string, endDate: string): string {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const startDay = start.getDate();
  const endDay = end.getDate();
  const startMonth = MONTHS[start.getMonth()];
  const endMonth = MONTHS[end.getMonth()];

  if (start.getTime() === end.getTime()) {
    return `${startDay} ${startMonth}`;
  }
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${startDay} – ${endDay} ${startMonth}`;
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
  }
  return `${startDay} ${startMonth} ${start.getFullYear()} – ${endDay} ${endMonth} ${end.getFullYear()}`;
}

export function formatInvitationDuration(startDate: string, endDate: string): string {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  return days === 1 ? '(1 Day)' : `(${days} Days)`;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<\/?[^>]+(>|$)/g, "");
}

function qrImageUrl(link: string | null | undefined): string {
  const qrData = link && link.trim() ? link : 'https://uasa.ae';
  return `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrData)}`;
}

function optionalBlock(label: string, value: string | null | undefined): string {
  if (!value) return '';
  return `<div style="margin-top:8px;font-size:13px;color:#374151;line-height:1.4;"><strong>${label}:</strong> ${escapeHtml(value)}</div>`;
}

function actionButton(label: string, href: string | null | undefined): string {
  if (!href) {
    return `<div style="margin-top:10px;font-size:13px;color:#6B7280;">Link not configured</div>`;
  }
  const safeHref = escapeHtml(href);
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
      <tr>
        <td bgcolor="#0B6B3A" style="background:#0B6B3A;border-radius:8px;">
          <a href="${safeHref}" target="_blank"
             style="display:block;padding:10px 16px;font-family:Arial,Helvetica,sans-serif;
                    font-size:14px;line-height:14px;font-weight:700;color:#ffffff;
                    text-decoration:none;border-radius:8px;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

export interface InvitationEmailData {
  participantName?: string;
  programLabel: string;
  workshopTitle: string;
  subtitle: string;
  startDate: string;
  endDate: string;
  timeSlot: string;
  meetingLink?: string | null;
  meetingId?: string | null;
  meetingPasscode?: string | null;
  trainingMaterialsUrl?: string | null;
  preAssessmentUrl?: string | null;
  postAssessmentUrl?: string | null;
  bannerUrl: string;
}

export function invitationEmailHtml(data: InvitationEmailData): string {
  const greeting = data.participantName
    ? `Dear ${escapeHtml(data.participantName)},`
    : 'Dear Participant,';
  const dateRange = formatInvitationDateRange(data.startDate, data.endDate);
  const duration = formatInvitationDuration(data.startDate, data.endDate);
  const programLabel = escapeHtml(data.programLabel);
  const workshopTitle = escapeHtml(data.workshopTitle);
  const subtitle = escapeHtml(stripHtmlTags(data.subtitle || ''));
  const timeSlot = escapeHtml(data.timeSlot || 'TBA');
  const bannerUrl = escapeHtml(data.bannerUrl);
  const meetingLink = data.meetingLink || '#';
  const materialsQr = qrImageUrl(data.trainingMaterialsUrl);
  const preAssessmentQr = qrImageUrl(data.preAssessmentUrl);
  const postAssessmentQr = qrImageUrl(data.postAssessmentUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>UASA Training Invitation</title>
<style>
@media screen and (max-width:600px){
  .container{width:100%!important}
  .stack{display:block!important;width:100%!important}
  .px{padding-left:16px!important;padding-right:16px!important}
  .title{font-size:20px!important}
  .center-mobile{text-align:center!important}
  img{max-width:100%!important;height:auto!important}
  .card-col{display:block!important;width:100%!important;padding:0 0 12px 0!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:#F4FBF7;font-family:Arial,Helvetica,sans-serif;color:#1F2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4FBF7;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" class="container" cellpadding="0" cellspacing="0"
        style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.08);">
        <tr>
          <td align="center" class="px" style="padding:20px 28px;">
            <img src="${LOGO_URL}"
              alt="Union of Arab Securities Authorities &amp; Capital Market Authority"
              width="520"
              style="display:block;width:520px;max-width:100%;height:auto;margin:0;border:0;outline:none;text-decoration:none;">
          </td>
        </tr>
        <tr>
          <td style="background:#0B6B3A;">
            <div class="px" style="padding:26px 28px 0 28px;color:#ffffff;">
              <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#D1FAE5;">
                ${programLabel}
              </div>
              <div class="title" style="font-size:24px;font-weight:700;margin-top:8px;">
                ${workshopTitle}
              </div>
              <div style="font-size:14px;color:#ECFDF5;margin-top:6px;padding-bottom:18px;">
                ${subtitle}
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0;background:#ffffff;">
            <img src="${bannerUrl}" width="600" height="140" alt=""
              style="display:block;width:600px;height:160px;max-width:100%;border:0;outline:none;text-decoration:none;">
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:22px 28px;">
            <p style="margin:0 0 12px 0;">${greeting}</p>
            <p style="margin:0 0 14px 0;">
              Thank you for registering for the <strong>Online CPD</strong> —
              <strong>${workshopTitle} – ${subtitle}</strong>.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0 0;">
              <tr>
                <td class="stack card-col" width="33.33%" valign="top" style="padding:0 0 12px 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                    style="background:#F4FBF7;border:1px solid #D1FAE5;border-radius:12px;">
                    <tr>
                      <td style="padding:14px;">
                        <div style="font-size:14px;font-weight:700;color:#111827;">📅 Date</div>
                        <div style="margin-top:6px;color:#111827;">
                          ${escapeHtml(dateRange)}<br>
                          <span style="font-size:13px;color:#6B7280;">${escapeHtml(duration)}</span>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td class="stack card-col" width="33.33%" valign="top" style="padding:0 0 12px 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                    style="background:#F4FBF7;border:1px solid #D1FAE5;border-radius:12px;">
                    <tr>
                      <td style="padding:14px;">
                        <div style="font-size:14px;font-weight:700;color:#111827;">⏰ Time</div>
                        <div style="margin-top:6px;color:#111827;">
                          ${timeSlot}<br>
                          <span style="font-size:13px;color:#6B7280;">UAE Time</span>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td class="stack card-col" width="33.33%" valign="top" style="padding:0 0 0 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                    style="background:#F4FBF7;border:1px solid #D1FAE5;border-radius:12px;">
                    <tr>
                      <td style="padding:14px;">
                        <div style="font-size:14px;font-weight:700;color:#111827;">📍 Location</div>
                        <div style="margin-top:6px;">
                          <a href="${escapeHtml(meetingLink)}"
                            style="color:#0B6B3A;font-weight:700;text-decoration:none;">
                            Join Meeting
                          </a>
                        </div>
                        ${optionalBlock('Meeting ID', data.meetingId)}
                        ${optionalBlock('Passcode', data.meetingPasscode)}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0 0;border-collapse:collapse;">
              <tr>
                <td class="stack card-col" width="33.33%" valign="top" style="padding:0 0 12px 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                    style="background:#F4FBF7;border:1px solid #D1FAE5;border-radius:12px;">
                    <tr>
                      <td style="padding:14px;">
                        <div style="font-size:14px;font-weight:700;color:#111827;">⬇️ Training Materials</div>
                        <div style="margin-top:10px;text-align:center;">
                          ${actionButton('Download', data.trainingMaterialsUrl)}
                        </div>
                        <div style="margin-top:10px;text-align:center;">
                          <img src="${materialsQr}" alt="Scan QR Code" width="120"
                            style="display:block;width:120px;max-width:100%;height:auto;border:0;margin:0 auto;">
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td class="stack card-col" width="33.33%" valign="top" style="padding:0 0 12px 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                    style="background:#F4FBF7;border:1px solid #D1FAE5;border-radius:12px;">
                    <tr>
                      <td style="padding:14px;">
                        <div style="font-size:14px;font-weight:700;color:#111827;">📝 Pre-Training Assessment</div>
                        <div style="margin-top:10px;">
                          ${actionButton('Submit Response', data.preAssessmentUrl)}
                        </div>
                        <div style="margin-top:10px;text-align:center;">
                          <img src="${preAssessmentQr}" alt="Scan QR Code" width="120"
                            style="display:block;width:120px;max-width:100%;height:auto;border:0;margin:0 auto;">
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td class="stack card-col" width="33.33%" valign="top" style="padding:0 0 0 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                    style="background:#F4FBF7;border:1px solid #D1FAE5;border-radius:12px;">
                    <tr>
                      <td style="padding:14px;">
                        <div style="font-size:14px;font-weight:700;color:#111827;">📋 Post-Training Assessment &amp; Evaluation</div>
                        <div style="margin-top:10px;font-size:13px;color:#B42318;font-weight:700;line-height:1.35;">
                          (Mandatory - Minimum score: 60/100)
                        </div>
                        <div style="margin-top:10px;">
                          ${actionButton('Submit Response', data.postAssessmentUrl)}
                        </div>
                        <div style="margin-top:8px;font-size:13px;color:#111827;line-height:1.35;">
                          (Opens after the training session ends)
                        </div>
                        <div style="margin-top:10px;text-align:center;">
                          <img src="${postAssessmentQr}" alt="Scan QR Code" width="120"
                            style="display:block;width:120px;max-width:100%;height:auto;border:0;margin:0 auto;">
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <div style="margin-top:18px;background:#ECFDF5;border-left:4px solid #0B6B3A;padding:14px;border-radius:10px;">
              <strong>Important Guidelines</strong>
              <ul style="margin:8px 0 0 18px;padding:0;color:#111827;line-height:1.5;">
                <li>Your full attendance at this training program is required to receive the CPD hours.</li>
                <li>We encourage you to join the session 15 minutes prior to the start time.</li>
                <li>Please block your calendar and ensure full participation.</li>
                <li>Participants must complete the <strong>Post-Training Assessment &amp; Evaluation</strong> via the link below (or by scanning the QR code if the link is blocked) promptly after the session; this step is mandatory, and a minimum score of 60/100 is required to receive the CPD hours.</li>
              </ul>
            </div>
            <p style="margin:16px 0 0 0;">We look forward to welcoming you to the session.</p>
            <p style="margin:16px 0 0 0;">
              Best regards,<br>
              <strong>UASA Training &amp; Development Team</strong>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
