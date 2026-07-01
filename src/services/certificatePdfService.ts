import PDFDocument from 'pdfkit';
import {
  CMA_LOGO_FILE,
  resolveLogoPath,
  UASA_LOGO_FILE,
} from './certificateAssets.js';
import type { CertificateData } from './certificateTemplate.js';
import {
  CERTIFICATE_BG,
  CERTIFICATE_BLACK,
  CERTIFICATE_BUBBLE,
  CERTIFICATE_GREEN,
} from './certificateTemplate.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

function defaultNoteText(cpdHours?: number, category?: string): string {
  if (!cpdHours) return '';
  const cat = category || 'Other Topics';
  const catText = cat === 'Other Topics'
    ? 'workshops on other topics'
    : 'workshops on AML / Cybersecurity / Securities Innovation';
  return `${cpdHours} hours of ${catText} by CMA (Mandatory)`;
}

function noteText(data: CertificateData): string {
  if (data.certificateNote) return data.certificateNote;
  return defaultNoteText(data.cpdHours, data.category);
}

function drawBubbles(doc: PdfDoc, pageH: number) {
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
  const scale = pageH / 595;
  doc.save();
  doc.opacity(0.55);
  for (const {x, y, r} of circles) {
    if (y * scale > pageH) continue;
    doc.circle(x, y * scale, r * scale).fill(CERTIFICATE_BUBBLE);
  }
  doc.opacity(1);
  doc.restore();
}

function placeLogo(
  doc: PdfDoc,
  file: string,
  x: number,
  y: number,
  maxHeight: number,
  maxWidth: number
) {
  doc.image(resolveLogoPath(file), x, y, {
    fit: [maxWidth, maxHeight],
    align: 'center',
  });
}

export function certificateDataToPdf(data: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const w = doc.page.width;
    const h = doc.page.height;
    const contentLeft = 88;
    const contentWidth = w - contentLeft - 48;

    doc.rect(0, 0, w, h).fill(CERTIFICATE_BG);
    doc.rect(0.75, 0.75, w - 1.5, h - 1.5).lineWidth(1.5).stroke(CERTIFICATE_BLACK);

    drawBubbles(doc, h);

    try {
      placeLogo(doc, UASA_LOGO_FILE, contentLeft, 22, 55, 210);
      placeLogo(doc, CMA_LOGO_FILE, w - 36 - 170, 18, 62, 170);
    } catch (err) {
      console.warn('Certificate logo missing for PDF:', err);
    }

    // Title starts at y = 120 (40pt gap below logos)
    let y = 120;

    doc.font('Times-Italic').fontSize(48).fillColor('#35532f');
    doc.text('Certificate of Participation', contentLeft, y, {
      width: contentWidth,
      align: 'center',
    });
    y += 48 + 27; // 27pt gap below title text to keep intro start at y = 195

    doc.font('Times-Roman').fontSize(14).fillColor(CERTIFICATE_BLACK);
    doc.text('The Capital Market Authority hereby certifies that:', contentLeft, y, {
      width: contentWidth,
      align: 'center',
    });
    y += 14 + 36; // 36pt gap below intro, centering recipient name vertically

    doc.font('Times-Bold').fontSize(28).fillColor(CERTIFICATE_BLACK);
    doc.text(data.participantName.toUpperCase(), contentLeft, y, {
      width: contentWidth,
      align: 'center',
      characterSpacing: 1.0,
    });
    const nameH = doc.heightOfString(data.participantName.toUpperCase(), { width: contentWidth, characterSpacing: 1.0 });
    y += nameH + 40; // 40pt gap below recipient name

    const details = [
      'Has attended the online training program organized in cooperation with',
      'The Union of Arab Securities Authorities',
      'on:',
    ];
    doc.font('Times-Roman').fontSize(14);
    for (const line of details) {
      doc.text(line, contentLeft, y, { width: contentWidth, align: 'center' });
      y += 20;
    }

    y += 21; // 21pt gap from details block to course title
    doc.font('Times-Bold').fontSize(21).fillColor(CERTIFICATE_BLACK);
    const quoteTitle = `\u201C${data.workshopTitle}\u201D`;
    doc.text(quoteTitle, contentLeft, y, {
      width: contentWidth,
      align: 'center',
      lineGap: 8,
    });
    const titleH = doc.heightOfString(quoteTitle, { width: contentWidth, lineGap: 8 });
    y += titleH + 28; // 28pt gap above date

    doc.font('Times-Bold').fontSize(16).fillColor(CERTIFICATE_BLACK);
    doc.text(data.workshopDates, contentLeft, y, { width: contentWidth, align: 'center' });
    y += 16 + 14; // 14pt gap below date

    const note = noteText(data);
    if (note) {
      doc.font('Times-Roman').fontSize(11).fillColor(CERTIFICATE_BLACK);
      doc.text(note, contentLeft, y, { width: contentWidth, align: 'center', lineGap: 3.5 });
    }

    const ref = `Ref: ${data.referenceNumber}`;
    doc.save();
    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    doc.rotate(-90, { origin: [w - 14, h - 48] });
    doc.text(ref, w - 14, h - 48, { lineBreak: false });
    doc.restore();

    doc.end();
  });
}
