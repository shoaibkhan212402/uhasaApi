import PDFDocument from 'pdfkit';
import type { InvoiceData } from './invoiceTemplate.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PdfDoc = InstanceType<typeof PDFDocument>;

// Colors & Layout Constants
const GREEN_COLOR = '#C5E0B3'; // Exact light green brand color
const BLACK = '#000000';
const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FS_SM = 9;   // small font
const FS = 10;     // base font size
const FS_LG = 24;  // TAX INVOICE heading
const FS_MD = 12;  // company name
const MARGIN = 40;

const UASA_ADDRESS = [
  'P.O Box: 117555 – Dubai',
  'United Arab Emirates',
  'Tel: +971 4 290 0056',
  'Email: info@uasa.ae',
  'TRN: 100547434900003',
];

const PAYMENT_DETAILS = [
  'Emirates Islamic Bank',
  'Khalidiya Branch',
  'Abu Dhabi – UAE',
  'Account Name: Union of Arab Securities Authorities',
  'Account No. : 3707381362101',
  'IBAN No. : AE730340003707381362101',
  'SWIFT code: MEBLAEAD',
  'TRN: 100547434900003',
];

// ─── primitives ─────────────────────────────────────────────────────────────

function border(doc: PdfDoc, x: number, y: number, w: number, h: number) {
  doc.save().lineWidth(0.5).strokeColor(BLACK).rect(x, y, w, h).stroke().restore();
}

function fillOnly(doc: PdfDoc, x: number, y: number, w: number, h: number, fill: string) {
  doc.save().fillColor(fill).rect(x, y, w, h).fill().restore();
}

function filledBox(doc: PdfDoc, x: number, y: number, w: number, h: number, fill: string) {
  doc.save()
    .fillColor(fill).rect(x, y, w, h).fill()
    .lineWidth(0.5).strokeColor(BLACK).rect(x, y, w, h).stroke()
    .restore();
}

function hLine(doc: PdfDoc, x: number, y: number, w: number) {
  doc.save().lineWidth(0.5).strokeColor(BLACK).moveTo(x, y).lineTo(x + w, y).stroke().restore();
}

function vLine(doc: PdfDoc, x: number, y: number, h: number) {
  doc.save().lineWidth(0.5).strokeColor(BLACK).moveTo(x, y).lineTo(x, y + h).stroke().restore();
}

function textH(doc: PdfDoc, s: number, bold = false) {
  doc.fontSize(s).font(bold ? FONT_BOLD : FONT_REGULAR).fillColor(BLACK);
}

function strH(doc: PdfDoc, text: string, width: number, bold = false, size = FS): number {
  return doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(size).heightOfString(text || ' ', { width });
}

// ─── layout constants ────────────────────────────────────────────────────────

const PAD = 8;
const LINE_GAP = 12; // Tightened slightly to ensure perfect line fits

export function invoiceDataToPdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width - MARGIN * 2;   // usable page width
    const LW = Math.round(PW * 0.58);          // left column (58% width)
    const RW = PW - LW;                         // right column (42% width)

    let y = MARGIN;

    // ── 1. Header Boxed Layout (Perfected Spacing) ───────────────────────────
    const HEADER_H = 105;

    // Outer frame for header row
    border(doc, MARGIN, y, PW, HEADER_H);
    // Vertical divider line (aligns at exactly 58%)
    vLine(doc, MARGIN + LW, y, HEADER_H);

    const logoPath = path.join(__dirname, '..', 'assets', 'certificates', 'logo-2.png');
    let hasLogo = fs.existsSync(logoPath);

    if (hasLogo) {
      try {
        // Draw UASA Logo inside the left box (height 26 fits perfectly)
        doc.image(logoPath, MARGIN + PAD, y + PAD + 1, { height: 26 });
      } catch (err) {
        console.error('Error drawing logo in PDF:', err);
        hasLogo = false;
      }
    }

    if (!hasLogo) {
      // Text fallback
      textH(doc, FS_MD, true);
      doc.text('Union of Arab Securities', MARGIN + PAD, y + PAD, { width: LW - PAD * 2 });
      doc.text('Authorities', MARGIN + PAD, y + PAD + 15, { width: LW - PAD * 2 });
    }

    // Address details inside the left box
    textH(doc, FS);
    let ay = y + PAD + (hasLogo ? 34 : 32);
    for (const line of UASA_ADDRESS) {
      doc.text(line, MARGIN + PAD, ay, { width: LW - PAD * 2, lineBreak: false });
      ay += LINE_GAP;
    }

    // Centered TAX INVOICE heading inside the right box
    textH(doc, FS_LG, true);
    doc.text('TAX INVOICE', MARGIN + LW, y + HEADER_H / 2 - FS_LG / 2 - 4, {
      width: RW,
      align: 'center',
    });

    y += HEADER_H;

    // ── 2. Billing + Meta (Same Boxed Alignment) ────────────────────────────
    const billingFields: { label: string; value: string }[] = [
      { label: 'Billed to:', value: data.billedTo || '' },
      { label: 'Address:', value: data.billedAddress || '' },
      { label: 'TRN:', value: data.billedTrn || '' },
    ];

    const LABEL_W = 70;
    const VAL_W = LW - PAD * 2 - LABEL_W;

    // Measure billing block height
    let billingInner = PAD;
    for (const f of billingFields) {
      billingInner += Math.max(strH(doc, f.value, VAL_W), 12) + 6;
    }
    billingInner += PAD;

    const META_ROW_H = 22;
    const BILLING_H = Math.max(billingInner, META_ROW_H * 3);

    // Draw frame around billing + meta section
    border(doc, MARGIN, y, PW, BILLING_H);
    // Vertical line splitting left (billing) and right (meta) columns at 58%
    vLine(doc, MARGIN + LW, y, BILLING_H);

    // Render billing fields on the left
    let by = y + PAD;
    for (const f of billingFields) {
      textH(doc, FS, true);
      doc.text(f.label, MARGIN + PAD, by, { width: LABEL_W, lineBreak: false });
      textH(doc, FS);
      doc.text(f.value || '', MARGIN + PAD + LABEL_W, by, { width: VAL_W });
      const rh = Math.max(strH(doc, f.value, VAL_W), 12) + 6;
      by += rh;
    }

    // Render meta fields on the right (exactly 3 rows aligned with the height)
    const metaRows: [string, string][] = [
      ['Invoice number:', data.invoiceNumber],
      ['Invoice date:', data.invoiceDate],
      ['Payment due:', data.paymentDueDate],
    ];
    const META_LW = Math.round(RW * 0.54); // Balanced width to prevent label wrapping
    const META_VW = RW - META_LW;

    const ROW_H = Math.floor(BILLING_H / 3);

    for (let i = 1; i < metaRows.length; i++) {
      hLine(doc, MARGIN + LW, y + i * ROW_H, RW);
    }
    vLine(doc, MARGIN + LW + META_LW, y, BILLING_H);

    for (let i = 0; i < metaRows.length; i++) {
      const [lbl, val] = metaRows[i];
      const ry = y + i * ROW_H + (ROW_H - FS) / 2;
      textH(doc, FS, true);
      doc.text(lbl, MARGIN + LW + PAD, ry, { width: META_LW - PAD * 2, lineBreak: false });
      textH(doc, FS);
      doc.text(val, MARGIN + LW + META_LW + PAD, ry, { width: META_VW - PAD * 2, lineBreak: false });
    }

    y += BILLING_H;

    // ── 3. Items table ───────────────────────────────────────────────────────
    const C_DESC = LW;
    const C_QTY  = Math.round(PW * 0.12);
    const C_RATE = Math.round(PW * 0.14);
    const C_AMT  = PW - C_DESC - C_QTY - C_RATE;
    const ITEMS_HEAD_H = 24;
    const descW = C_DESC - PAD * 2;

    // Normalise: use lineItems when available, fall back to single-item format
    const lineItems = data.lineItems && data.lineItems.length > 0
      ? data.lineItems
      : [{
          workshopTitle: data.workshopTitle,
          workshopFormat: data.workshopFormat || 'Online',
          workshopDates: data.workshopDates,
          participantCount: data.participantCount,
          unitPrice: data.unitPrice,
          amount: data.subtotal,
        }];

    // Pre-calculate row heights (each row height is content-driven)
    const rowHeights = lineItems.map((item) => {
      const desc = `Fees for "${item.workshopTitle}" ${item.workshopFormat || 'Online'} workshop -UAE, ${item.workshopDates}`;
      const partLine = `Participant: ${item.participantCount}`;
      const dh = strH(doc, desc, descW);
      const ph = strH(doc, partLine, descW);
      return Math.max(52, PAD + dh + 4 + ph + PAD);
    });
    const totalItemsH = rowHeights.reduce((s, h) => s + h, 0);
    const TOTAL_TABLE_H = ITEMS_HEAD_H + totalItemsH;

    // Table outer border + column lines (span full height)
    fillOnly(doc, MARGIN, y, PW, ITEMS_HEAD_H, GREEN_COLOR);
    border(doc, MARGIN, y, PW, TOTAL_TABLE_H);
    hLine(doc, MARGIN, y + ITEMS_HEAD_H, PW);
    vLine(doc, MARGIN + C_DESC, y, TOTAL_TABLE_H);
    vLine(doc, MARGIN + C_DESC + C_QTY, y, TOTAL_TABLE_H);
    vLine(doc, MARGIN + C_DESC + C_QTY + C_RATE, y, TOTAL_TABLE_H);

    // Header row
    textH(doc, FS, true);
    const hty = y + (ITEMS_HEAD_H - FS) / 2;
    doc.text('Item & Description', MARGIN + PAD, hty, { width: C_DESC - PAD * 2, lineBreak: false });
    doc.text('Quantity',           MARGIN + C_DESC, hty, { width: C_QTY, align: 'center', lineBreak: false });
    doc.text('Rate (AED)',         MARGIN + C_DESC + C_QTY, hty, { width: C_RATE, align: 'center', lineBreak: false });
    doc.text('Amount (AED)',       MARGIN + C_DESC + C_QTY + C_RATE, hty, { width: C_AMT, align: 'center', lineBreak: false });

    // Item rows
    let ry = y + ITEMS_HEAD_H;
    lineItems.forEach((item, idx) => {
      const rowH = rowHeights[idx];
      const desc = `Fees for "${item.workshopTitle}" ${item.workshopFormat || 'Online'} workshop -UAE, ${item.workshopDates}`;
      const partLine = `Participant: ${item.participantCount}`;
      const dh = strH(doc, desc, descW);

      if (idx > 0) hLine(doc, MARGIN, ry, PW);

      textH(doc, FS);
      doc.text(desc, MARGIN + PAD, ry + PAD, { width: descW });
      doc.text(partLine, MARGIN + PAD, ry + PAD + dh + 4, { width: descW });

      const vcY = ry + rowH / 2 - FS / 2;
      doc.text(String(item.participantCount), MARGIN + C_DESC, vcY, { width: C_QTY, align: 'center', lineBreak: false });
      doc.text(item.unitPrice.toFixed(0), MARGIN + C_DESC + C_QTY, vcY, { width: C_RATE, align: 'center', lineBreak: false });
      textH(doc, FS, true);
      doc.text(item.amount.toFixed(0), MARGIN + C_DESC + C_QTY + C_RATE, vcY, { width: C_AMT, align: 'center', lineBreak: false });

      ry += rowH;
    });

    y += TOTAL_TABLE_H;

    // ── 4. Bottom: Payment details + Totals (Exact Layout Restored) ──────────
    y += 15; // Spacer gap

    const payLinesCount = PAYMENT_DETAILS.length;      // 8 lines
    const PAY_HEADER_H = 22;
    const PAY_BODY_H   = PAD + 14 + payLinesCount * (FS + 3) + PAD;  // "In favor of:" + lines + padding
    const BOTTOM_H = Math.max(PAY_HEADER_H + PAY_BODY_H, 142);       // Payment block height (approx 142)

    // Payment details box — left side (drawn as a single outer frame with a dividing line to prevent double borders)
    fillOnly(doc, MARGIN, y, LW, PAY_HEADER_H, GREEN_COLOR);
    border(doc, MARGIN, y, LW, BOTTOM_H);
    hLine(doc, MARGIN, y + PAY_HEADER_H, LW);

    textH(doc, FS, true);
    doc.text('Payment Details:', MARGIN + PAD, y + (PAY_HEADER_H - FS) / 2, {
      width: LW - PAD * 2, lineBreak: false,
    });

    textH(doc, FS, true);
    doc.text('In favor of:', MARGIN + PAD, y + PAY_HEADER_H + PAD, { lineBreak: false });

    textH(doc, FS);
    let py = y + PAY_HEADER_H + PAD + 14;
    for (const line of PAYMENT_DETAILS) {
      doc.text(line, MARGIN + PAD, py, { width: LW - PAD * 2, lineBreak: false });
      py += FS + 3;
    }

    // Totals table — right side (Compact, 3 rows of exactly 22pt height each = 66pt total height)
    const TOTALS_HEIGHT = 66; 
    const TOT_H = 22;
    const TOT_LW = Math.round(RW * 0.62); // 62% of RW width
    const TOT_VW = RW - TOT_LW;          // 38% of RW width

    const totalRows: [string, string][] = [
      ['Total before VAT (AED)', data.subtotal.toFixed(2)],
      ['VAT (5%)',               data.vatAmount.toFixed(2)],
      ['Grand total (AED)',      data.totalAmount.toFixed(2)],
    ];

    // 1. Fill background colors FIRST (Painter's algorithm: draw fills before drawing borders/lines on top)
    for (let i = 0; i < totalRows.length; i++) {
      const rowY = y + i * TOT_H;
      // Fill the green label cells
      fillOnly(doc, MARGIN + LW, rowY, TOT_LW, TOT_H, GREEN_COLOR);

      // Highlight only the Grand Total value cell with a light green background tint
      if (i === 2) {
        fillOnly(doc, MARGIN + LW + TOT_LW, rowY, TOT_VW, TOT_H, '#F0FDF4');
      }
    }

    // 2. Draw all lines and borders ON TOP of the filled cells
    border(doc, MARGIN + LW, y, RW, TOTALS_HEIGHT); // Outer boundary
    vLine(doc, MARGIN + LW + TOT_LW, y, TOTALS_HEIGHT); // Vertical separator divider
    for (let i = 1; i < totalRows.length; i++) {
      hLine(doc, MARGIN + LW, y + i * TOT_H, RW); // Horizontal separators
    }

    // 3. Render the text on top
    for (let i = 0; i < totalRows.length; i++) {
      const rowY = y + i * TOT_H;
      const tY = rowY + (TOT_H - FS) / 2;
      const isGrandTotal = i === 2;

      // Label text
      textH(doc, FS, true);
      doc.text(totalRows[i][0], MARGIN + LW + PAD, tY, { width: TOT_LW - PAD * 2, lineBreak: false });
      
      // Value text
      textH(doc, FS, isGrandTotal);
      doc.text(totalRows[i][1], MARGIN + LW + TOT_LW + PAD, tY, { width: TOT_VW - PAD * 2, align: 'right', lineBreak: false });
    }

    doc.end();
  });
}

export async function buildInvoicePdfAttachment(data: InvoiceData) {
  const content = await invoiceDataToPdf(data);
  return {
    filename: `${data.invoiceNumber}.pdf`,
    content,
    contentType: 'application/pdf',
  };
}
