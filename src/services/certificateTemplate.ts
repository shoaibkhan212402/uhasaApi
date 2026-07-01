import { config } from '../config.js';
import { CMA_LOGO_FILE, UASA_LOGO_FILE } from './certificateAssets.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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

function enumerateDays(startDate: string, endDate: string): number[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const days: number[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(cursor.getDate());
    cursor.setDate(cursor.getDate() + 1);
  }
  return days.length ? days : [start.getDate()];
}

export function workshopAcronym(title: string): string {
  const cleaned = title.replace(/["""]/g, '').trim();
  const words = cleaned.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length >= 2) {
    return words.map((w) => w[0].toUpperCase()).join('').slice(0, 8);
  }
  const letters = cleaned.replace(/[^A-Za-z]/g, '');
  return (letters.slice(0, 3) || 'WS').toUpperCase();
}

export function formatCertificateDates(startDate: string, endDate: string): string {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const days = enumerateDays(startDate, endDate);
  const month = MONTHS[end.getMonth()];
  const year = end.getFullYear();

  const dayParts = days.map((d) => String(d).padStart(2, '0'));
  let dayText: string;
  if (dayParts.length === 1) {
    dayText = dayParts[0];
  } else if (dayParts.length === 2) {
    dayText = `${dayParts[0]} and ${dayParts[1]}`;
  } else {
    dayText = `${dayParts.slice(0, -1).join(', ')} and ${dayParts[dayParts.length - 1]}`;
  }

  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `Held on ${dayText} ${month} ${year}`;
  }

  return `Held on ${formatInvitationStyleRange(startDate, endDate)}`;
}

function formatInvitationStyleRange(startDate: string, endDate: string): string {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const sDay = String(start.getDate()).padStart(2, '0');
  const eDay = String(end.getDate()).padStart(2, '0');
  const sMonth = MONTHS[start.getMonth()];
  const eMonth = MONTHS[end.getMonth()];
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${sDay} – ${eDay} ${eMonth} ${end.getFullYear()}`;
  }
  return `${sDay} ${sMonth} ${start.getFullYear()} – ${eDay} ${eMonth} ${end.getFullYear()}`;
}

export function buildReferenceNumber(title: string, startDate: string, endDate: string): string {
  const acronym = workshopAcronym(title);
  const days = enumerateDays(startDate, endDate);
  const end = parseDate(endDate);
  const dayStr = days.map((d) => String(d).padStart(2, '0')).join('');
  const month = MONTHS_SHORT[end.getMonth()];
  const year = String(end.getFullYear()).slice(-2);
  return `${acronym}-${dayStr}${month}${year}`;
}

export interface CertificateData {
  participantName: string;
  workshopTitle: string;
  workshopDates: string;
  referenceNumber: string;
  certificateNote?: string | null;
  cpdHours?: number;
  programLabel?: string;
  workshopSubtitle?: string | null;
  assetsBaseUrl?: string;
  uasaLogoUrl?: string;
  cmaLogoUrl?: string;
  emailHeroUrl?: string;
  category?: string;
}

function assetsBase(data: CertificateData): string {
  return (data.assetsBaseUrl || config.certificateAssetsBaseUrl).replace(/\/$/, '');
}

function defaultNoteText(cpdHours?: number, category?: string): string {
  if (!cpdHours) return '';
  const cat = category || 'Other Topics';
  const catText = cat === 'Other Topics'
    ? 'workshops on other topics'
    : 'workshops on AML / Cybersecurity / Securities Innovation';
  return `${cpdHours} hours of ${catText} by CMA (Mandatory)`;
}

export const CERTIFICATE_GREEN = '#2E4D31';
export const CERTIFICATE_BLACK = '#1a1a1a';
export const CERTIFICATE_BG = '#F9FAF7';
export const CERTIFICATE_BUBBLE = '#D8E8DC';
// cx values 6–22 keep circles in a narrow left-edge column (~7.6% of width), transition to bottom
function bubbleDecoration(): string {
  const circles = [
    { x: 10, y: 15, r: 8 },
    { x: 22, y: 40, r: 4 },
    { x: 48, y: 18, r: 7 },
    { x: 14, y: 70, r: 12 },
    { x: 35, y: 85, r: 6 },
    { x: 8,  y: 110, r: 9 },
    { x: 25, y: 130, r: 15 },
    { x: 50, y: 115, r: 5 },
    { x: 12, y: 160, r: 11 },
    { x: 42, y: 175, r: 7 },
    { x: 20, y: 200, r: 13 },
    { x: 34, y: 225, r: 5 },
    { x: 10, y: 250, r: 9 },
    { x: 55, y: 240, r: 6 },
    { x: 28, y: 275, r: 14 },
    { x: 15, y: 310, r: 10 },
    { x: 45, y: 320, r: 4 },
    { x: 8,  y: 350, r: 7 },
    { x: 26, y: 370, r: 16 },
    { x: 52, y: 385, r: 6 },
    { x: 18, y: 410, r: 12 },
    { x: 38, y: 430, r: 5 },
    { x: 12, y: 460, r: 8 },
    { x: 58, y: 465, r: 7 },
    { x: 28, y: 490, r: 13 },
    { x: 50, y: 520, r: 10 },
    { x: 75, y: 505, r: 6 },
    { x: 90, y: 535, r: 14 },
    { x: 115, y: 520, r: 5 },
    { x: 130, y: 550, r: 11 },
    { x: 155, y: 535, r: 7 },
    { x: 180, y: 565, r: 15 },
    { x: 210, y: 550, r: 8 },
    { x: 240, y: 575, r: 12 },
    { x: 275, y: 560, r: 6 },
    { x: 310, y: 580, r: 9 },
    { x: 350, y: 570, r: 14 },
    { x: 390, y: 585, r: 5 },
    { x: 430, y: 575, r: 11 },
    { x: 480, y: 590, r: 7 },
    { x: 530, y: 580, r: 13 },
    { x: 580, y: 595, r: 6 },
    { x: 640, y: 585, r: 10 },
    { x: 700, y: 590, r: 5 },
    { x: 760, y: 580, r: 8 },
    { x: 820, y: 595, r: 12 }
  ];
  return circles
    .map(({x, y, r}) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${CERTIFICATE_BUBBLE}" opacity="0.55"/>`)
    .join('');
}

export function certificateHtml(data: CertificateData): string {
  const uasaLogo = data.uasaLogoUrl || `${assetsBase(data)}/${UASA_LOGO_FILE}`;
  const cmaLogo = data.cmaLogoUrl || `${assetsBase(data)}/${CMA_LOGO_FILE}`;
  const name = escapeHtml(data.participantName.toUpperCase());
  const title = escapeHtml(data.workshopTitle);
  const dates = escapeHtml(data.workshopDates);
  const ref = escapeHtml(data.referenceNumber);
  const note = data.certificateNote
    ? escapeHtml(data.certificateNote)
    : defaultNoteText(data.cpdHours, data.category);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Certificate of Participation — ${name}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%;
    min-height: 100%;
  }
  body {
    margin: 0;
    background: #e8ece9;
    font-family: Georgia, 'Times New Roman', Times, serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 100%;
    max-width: 297mm;
    height: auto;
    aspect-ratio: 297 / 210;
    margin: 0 auto;
    background: ${CERTIFICATE_BG};
    border: 1.5px solid ${CERTIFICATE_BLACK};
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
  }
  .bubbles {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 3.2cqw 3.2cqw 0 8.5cqw;
    position: relative;
    z-index: 1;
  }
  .logo-block {
    display: flex;
    align-items: center;
    max-width: 46%;
  }
  .logo-block.right {
    justify-content: flex-end;
  }
  .logo-block img {
    height: 55px;
    width: auto;
    max-width: 100%;
    object-fit: contain;
    flex-shrink: 0;
  }
  .logo-block img.cma {
    height: 62px;
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    text-align: center;
    padding: 0 4.3cqw 2cqw 8.5cqw;
    padding-top: 4.8cqw;
    position: relative;
    z-index: 1;
  }
  .cert-title {
    font-family: Georgia, serif;
    font-style: italic;
    font-weight: 400;
    color: #35532f;
    font-size: clamp(24px, 4.2cqw, 48px);
    line-height: 1;
    margin-top: 0;
    margin-bottom: 2.25cqw;
  }
  .intro {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-size: clamp(11px, 1.25cqw, 14px);
    font-weight: 400;
    color: ${CERTIFICATE_BLACK};
    margin: 0;
    margin-bottom: 4.25cqw;
    line-height: 1.45;
  }
  .recipient {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-size: clamp(16px, 2.5cqw, 28px);
    font-weight: 700;
    color: ${CERTIFICATE_BLACK};
    letter-spacing: 1px;
    margin: 0;
    margin-bottom: 4.75cqw;
    line-height: 1.25;
    max-width: 92%;
  }
  .detail {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-size: clamp(11px, 1.25cqw, 14px);
    font-weight: 400;
    color: ${CERTIFICATE_BLACK};
    line-height: 1.55;
    margin: 0;
    margin-bottom: 0.35cqw;
  }
  .detail.last {
    margin-bottom: 2.5cqw;
  }
  .course-title {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-size: clamp(14px, 1.87cqw, 21px);
    line-height: 1.6;
    font-weight: 700;
    color: ${CERTIFICATE_BLACK};
    max-width: 650px;
    margin: 0;
    margin-bottom: 3.3cqw;
  }
  .dates {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-size: clamp(12px, 1.42cqw, 16px);
    font-weight: 700;
    color: ${CERTIFICATE_BLACK};
    margin: 0;
    margin-bottom: 1.65cqw;
    line-height: 1.4;
  }
  .note {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-size: clamp(10px, 0.98cqw, 11px);
    font-weight: 400;
    color: ${CERTIFICATE_BLACK};
    max-width: 82%;
    margin: 0;
    line-height: 1.4;
  }
  .ref {
    position: absolute;
    right: 1%;
    bottom: 8%;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-family: Arial, Helvetica, sans-serif;
    font-size: clamp(6px, 0.8cqw, 9px);
    color: #444;
    letter-spacing: 0.03em;
    z-index: 2;
  }
</style>
</head>
<body>
<div class="page">
  <!-- viewBox matches A4 landscape (842×595 pt) so bubbles scale 1:1 with the page -->
  <svg class="bubbles" viewBox="0 0 842 595" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
    ${bubbleDecoration()}
  </svg>

  <header class="header">
    <div class="logo-block">
      <img src="${uasaLogo}" alt="Union of Arab Securities Authorities">
    </div>
    <div class="logo-block right">
      <img src="${cmaLogo}" alt="Capital Market Authority" class="cma">
    </div>
  </header>

  <main class="body">
    <h1 class="cert-title">Certificate of Participation</h1>
    <p class="intro">The Capital Market Authority hereby certifies that:</p>
    <p class="recipient">${name}</p>
    <p class="detail">Has attended the online training program organized in cooperation with</p>
    <p class="detail">The Union of Arab Securities Authorities</p>
    <p class="detail last">on:</p>
    <p class="course-title">&ldquo;${title}&rdquo;</p>
    <p class="dates">${dates}</p>
    ${note ? `<p class="note">${note}</p>` : ''}
  </main>

  <div class="ref">Ref: ${ref}</div>
</div>
</body>
</html>`;
}
