import { config } from '../config.js';
import { CERTIFICATE_EMAIL_HERO_FILE } from './certificateAssets.js';
import { certificateHtml, type CertificateData } from './certificateTemplate.js';

const LOGO_URL =
  'https://mcusercontent.com/0a756f44b6fd1328c8eaaaeed/images/30f642a2-83c7-d3c5-d69c-08e8482e9661.png';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return 'Participant';
  return trimmed.split(/\s+/)[0];
}

function assetsBase(data: CertificateData): string {
  return (data.assetsBaseUrl || config.certificateAssetsBaseUrl).replace(/\/$/, '');
}

function heroImageUrl(data: CertificateData): string {
  return data.emailHeroUrl || `${assetsBase(data)}/${CERTIFICATE_EMAIL_HERO_FILE}`;
}

function cpdCreditLine(data: CertificateData): string {
  if (data.certificateNote?.trim()) {
    return data.certificateNote.trim();
  }
  const hours = data.cpdHours ?? 0;
  if (hours > 0) {
    return `${hours} CPD Hour${hours === 1 ? '' : 's'} delivered by CMA have been credited`;
  }
  return 'Your CPD hours delivered by CMA have been credited';
}

function programDescription(data: CertificateData): string {
  const programLabel = escapeHtml(data.programLabel || 'Online CPD Program');
  const title = escapeHtml(data.workshopTitle);
  const subtitle = data.workshopSubtitle?.trim();

  if (subtitle) {
    return `${programLabel}: <strong>${title}</strong> – ${escapeHtml(subtitle)}`;
  }
  return `${programLabel}: <strong>${title}</strong>`;
}

function certificateEmailBody(data: CertificateData, pdfAttached: boolean): string {
  const greeting = escapeHtml(firstName(data.participantName));
  const programText = programDescription(data);
  const creditLine = escapeHtml(cpdCreditLine(data));
  const heroUrl = escapeHtml(heroImageUrl(data));
  const attachmentText = pdfAttached
    ? 'Please find attached <strong>your certificate</strong> for the above-mentioned program.'
    : 'Your Certificate of Participation is shown below. You may print or save this email for your records.';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Certificate Issued — ${escapeHtml(data.workshopTitle)}</title>
<style>
@media screen and (max-width:600px){
  .container{width:100%!important}
  .px{padding-left:16px!important;padding-right:16px!important}
  .title{font-size:22px!important}
  img{max-width:100%!important;height:auto!important}
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
          <td align="center" class="px" style="padding:20px 28px 12px 28px;">
            <img src="${LOGO_URL}"
              alt="Union of Arab Securities Authorities &amp; Capital Market Authority"
              width="520"
              style="display:block;width:520px;max-width:100%;height:auto;margin:0;border:0;outline:none;text-decoration:none;">
          </td>
        </tr>
        <tr>
          <td style="background:#0B6B3A;">
            <div class="px" style="padding:22px 28px 20px 28px;color:#ffffff;text-align:center;">
              <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#D1FAE5;">
                Online CPD Program
              </div>
              <div class="title" style="font-size:26px;font-weight:700;margin-top:8px;line-height:1.25;">
                Certificate Issued
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#E5E7EB;">
            <div class="px" style="padding:12px 28px;text-align:center;font-size:13px;line-height:1.45;color:#374151;">
              ${creditLine}
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0;background:#ffffff;">
            <img src="${heroUrl}" width="600" alt=""
              style="display:block;width:600px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:24px 28px 8px 28px;">
            <p style="margin:0 0 12px 0;font-size:15px;">Dear ${greeting},</p>
            <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;">Greetings from UASA and CMA,</p>
            <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;">
              It was a pleasure having you participate in the ${programText}.
              Thank you for your attendance and contribution.
            </p>
            <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;">
              ${attachmentText}
            </p>
            <div style="margin:18px 0 0 0;background:#F3F4F6;border-left:4px solid #0B6B3A;padding:14px 16px;border-radius:10px;">
              <strong style="display:block;margin-bottom:8px;color:#111827;">Please note:</strong>
              <p style="margin:0;font-size:14px;line-height:1.55;color:#111827;">
                The corresponding CPD hours are automatically reflected on your CMA <strong>profile</strong>.
              </p>
            </div>
            <p style="margin:18px 0 0 0;font-size:14px;line-height:1.6;">
              We look forward to welcoming you to our upcoming programs.
            </p>
            <p style="margin:16px 0 0 0;font-size:14px;line-height:1.6;">
              Best regards,<br>
              <strong>UASA Training &amp; Development Team</strong>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:0;line-height:0;font-size:0;">
            <div style="height:18px;background:#C4A35A;"></div>
            <div style="height:14px;background:#6B9E78;"></div>
            <div style="height:22px;background:#0B6B3A;border-radius:0 0 14px 14px;"></div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function certificateEmailHtml(data: CertificateData, pdfAttached = false): string {
  if (pdfAttached) {
    return certificateEmailBody(data, true);
  }

  const emailIntro = certificateEmailBody(data, false);
  return certificateHtml(data).replace(
    '<body>',
    `<body><div style="max-width:297mm;margin:0 auto 16px;">${emailIntro}</div>`
  );
}
