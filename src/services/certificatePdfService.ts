import PDFDocument from 'pdfkit';
import {
  CMA_LOGO_FILE,
  resolveLogoPath,
  UASA_LOGO_FILE,
} from './certificateAssets.js';
import type { CertificateData } from './certificateTemplate.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

const GREEN = '#2E5A31';
const BLACK = '#1a1a1a';
const BUBBLE = '#D8E8DC';

function noteText(data: CertificateData): string {
  if (data.certificateNote) return data.certificateNote;
  if (data.cpdHours) return `${data.cpdHours} CPD hours — Workshop participation certificate`;
  return '';
}

function drawBubbles(doc: PdfDoc, pageH: number) {
  const circles: [number, number, number][] = [
    [12, 18, 28], [8, 42, 18], [18, 68, 36], [6, 95, 14], [22, 120, 42],
    [10, 148, 22], [16, 175, 32], [8, 205, 16], [20, 230, 38], [12, 260, 24],
    [6, 285, 12], [18, 310, 30], [10, 340, 20], [14, 365, 26], [8, 395, 14],
    [22, 420, 40], [10, 450, 18], [16, 475, 34], [8, 505, 12], [20, 530, 28],
  ];
  const scale = pageH / 595;
  doc.save();
  doc.opacity(0.55);
  for (const [cx, cy, r] of circles) {
    if (cy * scale > pageH) continue;
    doc.circle(cx, cy * scale, r * scale).fill(BUBBLE);
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

    doc.rect(0.75, 0.75, w - 1.5, h - 1.5).lineWidth(1.5).stroke(BLACK);

    drawBubbles(doc, h);

    try {
      placeLogo(doc, UASA_LOGO_FILE, contentLeft, 22, 62, 260);
      placeLogo(doc, CMA_LOGO_FILE, w - 36 - 240, 18, 68, 240);
    } catch (err) {
      console.warn('Certificate logo missing for PDF:', err);
    }

    let y = 108;

    doc.font('Times-Italic').fontSize(34).fillColor(GREEN);
    doc.text('Certificate of Participation', contentLeft, y, {
      width: contentWidth,
      align: 'center',
    });
    y += 52;

    doc.font('Helvetica').fontSize(14).fillColor(BLACK);
    doc.text('The Capital Market Authority hereby certifies that:', contentLeft, y, {
      width: contentWidth,
      align: 'center',
    });
    y += 28;

    doc.font('Times-Bold').fontSize(26).fillColor(BLACK);
    doc.text(data.participantName.toUpperCase(), contentLeft, y, {
      width: contentWidth,
      align: 'center',
      characterSpacing: 1,
    });
    y += doc.heightOfString(data.participantName.toUpperCase(), { width: contentWidth }) + 14;

    const details = [
      'Has attended the online training program organized in cooperation with',
      'The Union of Arab Securities Authorities',
      'on:',
    ];
    doc.font('Helvetica').fontSize(14);
    for (const line of details) {
      doc.text(line, contentLeft, y, { width: contentWidth, align: 'center' });
      y += 20;
    }

    y += 4;
    doc.font('Times-Bold').fontSize(22).fillColor(BLACK);
    doc.text(`\u201C${data.workshopTitle}\u201D`, contentLeft, y, {
      width: contentWidth,
      align: 'center',
    });
    y += doc.heightOfString(`\u201C${data.workshopTitle}\u201D`, { width: contentWidth }) + 10;

    const dividerX = w / 2;
    doc.moveTo(dividerX, y).lineTo(dividerX, y + 22).lineWidth(1).stroke(BLACK);
    y += 32;

    doc.font('Helvetica-Bold').fontSize(15).fillColor(BLACK);
    doc.text(data.workshopDates, contentLeft, y, { width: contentWidth, align: 'center' });
    y += 24;

    const note = noteText(data);
    if (note) {
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(note, contentLeft, y, { width: contentWidth, align: 'center' });
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
