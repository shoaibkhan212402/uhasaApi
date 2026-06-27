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
}

function assetsBase(data: CertificateData): string {
  return (data.assetsBaseUrl || config.certificateAssetsBaseUrl).replace(/\/$/, '');
}

function bubbleDecoration(): string {
  const circles = [
    [12, 18, 28], [8, 42, 18], [18, 68, 36], [6, 95, 14], [22, 120, 42],
    [10, 148, 22], [16, 175, 32], [8, 205, 16], [20, 230, 38], [12, 260, 24],
    [6, 285, 12], [18, 310, 30], [10, 340, 20], [14, 365, 26], [8, 395, 14],
    [22, 420, 40], [10, 450, 18], [16, 475, 34], [8, 505, 12], [20, 530, 28],
    [12, 560, 22], [8, 585, 16], [18, 610, 36], [10, 640, 20], [14, 665, 30],
    [8, 695, 14], [20, 720, 38], [12, 750, 24],
  ];
  return circles
    .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#D8E8DC" opacity="0.55"/>`)
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
    : data.cpdHours
      ? escapeHtml(`${data.cpdHours} CPD hours — Workshop participation certificate`)
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Certificate of Participation — ${name}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    margin: 0;
    background: #e8ece9;
    font-family: Georgia, 'Times New Roman', Times, serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 297mm;
    height: 210mm;
    max-width: 100%;
    margin: 0 auto;
    background: #fff;
    border: 1.5px solid #1a1a1a;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .bubbles {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 72px;
    pointer-events: none;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 22px 36px 0 88px;
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
    height: 62px;
    width: auto;
    max-width: 100%;
    object-fit: contain;
    flex-shrink: 0;
  }
  .logo-block img.cma {
    height: 68px;
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 8px 48px 24px 88px;
    position: relative;
    z-index: 1;
  }
  .cert-title {
    font-size: 34px;
    font-style: italic;
    color: #2E5A31;
    font-weight: 400;
    margin-bottom: 18px;
    letter-spacing: 0.01em;
  }
  .intro {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 14px;
    color: #1a1a1a;
    margin-bottom: 14px;
  }
  .recipient {
    font-size: 26px;
    font-weight: 700;
    color: #1a1a1a;
    letter-spacing: 0.04em;
    margin-bottom: 16px;
    line-height: 1.25;
    max-width: 90%;
  }
  .detail {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 14px;
    color: #1a1a1a;
    line-height: 1.55;
    margin-bottom: 4px;
  }
  .course-title {
    font-size: 22px;
    font-weight: 700;
    color: #1a1a1a;
    margin: 14px 0 10px;
    line-height: 1.3;
    max-width: 85%;
  }
  .divider {
    width: 1px;
    height: 22px;
    background: #1a1a1a;
    margin: 6px auto 10px;
  }
  .dates {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: #1a1a1a;
    margin-bottom: 14px;
  }
  .note {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: #1a1a1a;
    margin-top: 6px;
    max-width: 80%;
    line-height: 1.4;
  }
  .ref {
    position: absolute;
    right: 14px;
    bottom: 48px;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9px;
    color: #444;
    letter-spacing: 0.03em;
    z-index: 2;
  }
  @media screen and (max-width: 900px) {
    .page { width: 100%; height: auto; min-height: 520px; }
    .cert-title { font-size: 26px; }
    .recipient { font-size: 20px; }
    .course-title { font-size: 18px; }
  }
</style>
</head>
<body>
<div class="page">
  <svg class="bubbles" viewBox="0 0 72 800" preserveAspectRatio="xMinYMin slice" aria-hidden="true">
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
    <p class="detail">on:</p>
    <p class="course-title">&ldquo;${title}&rdquo;</p>
    <div class="divider" aria-hidden="true"></div>
    <p class="dates">${dates}</p>
    ${note ? `<p class="note">${note}</p>` : ''}
  </main>

  <div class="ref">Ref: ${ref}</div>
</div>
</body>
</html>`;
}
