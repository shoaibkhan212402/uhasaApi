import PDFDocument from 'pdfkit';
import type { InvoiceData } from './invoiceTemplate.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

const GREEN = '#c5e0b4';
const BLACK = '#000000';
const FONT_SIZE = 10;
const LABEL_WIDTH = 68;
const PAD = 10;

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

function measureText(doc: PdfDoc, text: string, width: number, font: string): number {
  doc.font(font).fontSize(FONT_SIZE);
  return doc.heightOfString(text || ' ', { width });
}

function drawBox(doc: PdfDoc, x: number, y: number, w: number, h: number, fill?: string) {
  doc.save();
  doc.lineWidth(1).strokeColor(BLACK);
  if (fill) {
    doc.fillColor(fill).rect(x, y, w, h).fillAndStroke(fill, BLACK);
  } else {
    doc.fillColor(BLACK).rect(x, y, w, h).stroke();
  }
  doc.restore();
  doc.fillColor(BLACK).strokeColor(BLACK);
}

function drawHLine(doc: PdfDoc, x: number, y: number, w: number) {
  doc.save();
  doc.lineWidth(1).strokeColor(BLACK);
  doc.moveTo(x, y).lineTo(x + w, y).stroke();
  doc.restore();
}

function drawVLine(doc: PdfDoc, x: number, y: number, h: number) {
  doc.save();
  doc.lineWidth(1).strokeColor(BLACK);
  doc.moveTo(x, y).lineTo(x, y + h).stroke();
  doc.restore();
}

function drawFieldRow(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string
): number {
  const valueWidth = width - PAD * 2 - LABEL_WIDTH;
  doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor(BLACK);
  doc.text(label, x + PAD, y, { width: LABEL_WIDTH, lineBreak: false });
  doc.font('Helvetica').fontSize(FONT_SIZE);
  doc.text(value || '', x + PAD + LABEL_WIDTH, y, { width: valueWidth });
  return Math.max(measureText(doc, value, valueWidth, 'Helvetica'), 12) + 8;
}

function estimateBillingHeight(doc: PdfDoc, width: number, fields: { label: string; value: string }[]) {
  const valueWidth = width - PAD * 2 - LABEL_WIDTH;
  let height = PAD;
  for (const field of fields) {
    height += Math.max(measureText(doc, field.value, valueWidth, 'Helvetica'), 12) + 8;
  }
  return height + PAD;
}

function drawBillingBlock(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number,
  height: number,
  fields: { label: string; value: string }[]
) {
  drawBox(doc, x, y, width, height);
  let rowY = y + PAD;
  for (const field of fields) {
    rowY += drawFieldRow(doc, x, rowY, width, field.label, field.value);
  }
}

function drawMetaTable(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number,
  height: number,
  rows: [string, string][]
) {
  const labelWidth = width * 0.42;
  const valueWidth = width - labelWidth;
  const rowHeight = height / rows.length;

  drawBox(doc, x, y, width, height);
  for (let i = 1; i < rows.length; i++) {
    drawHLine(doc, x, y + i * rowHeight, width);
  }
  drawVLine(doc, x + labelWidth, y, height);

  rows.forEach(([label, value], index) => {
    const rowY = y + index * rowHeight;
    const textY = rowY + (rowHeight - FONT_SIZE) / 2;
    doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor(BLACK);
    doc.text(label, x + 8, textY, { width: labelWidth - 16, lineBreak: false });
    doc.font('Helvetica').fontSize(FONT_SIZE);
    doc.text(value, x + labelWidth + 8, textY, { width: valueWidth - 16, lineBreak: false });
  });
}

export function invoiceDataToPdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin = 40;
    const pageWidth = doc.page.width - margin * 2;
    const leftWidth = pageWidth * 0.58;
    const rightWidth = pageWidth - leftWidth;

    const description = `Fees for "${data.workshopTitle}" ${data.workshopFormat || 'Online'} workshop -UAE, ${data.workshopDates}`;
    const participantLine = `Participant: ${data.participantCount}`;

    const billingFields = [
      { label: 'Billed to:', value: data.billedTo || '' },
      { label: 'Address:', value: data.billedAddress || '' },
      { label: 'TRN:', value: data.billedTrn || '' },
    ];

    const metaRows: [string, string][] = [
      ['Invoice number:', data.invoiceNumber],
      ['Invoice date:', data.invoiceDate],
      ['Payment due:', data.paymentDueDate],
    ];

    const billingHeight = Math.max(estimateBillingHeight(doc, leftWidth, billingFields), metaRows.length * 26);

    let y = margin;

    // Header
    const headerHeight = 88;
    drawBox(doc, margin, y, leftWidth, headerHeight);
    drawBox(doc, margin + leftWidth, y, rightWidth, headerHeight);

    doc.font('Helvetica-Bold').fontSize(12).fillColor(BLACK);
    doc.text('Union of Arab Securities Authorities', margin + PAD, y + PAD, {
      width: leftWidth - PAD * 2,
    });
    doc.font('Helvetica').fontSize(FONT_SIZE);
    let addressY = y + 28;
    for (const line of UASA_ADDRESS) {
      doc.text(line, margin + PAD, addressY, { width: leftWidth - PAD * 2 });
      addressY += 13;
    }

    doc.font('Helvetica-Bold').fontSize(24);
    doc.text('TAX INVOICE', margin + leftWidth, y + 30, {
      width: rightWidth,
      align: 'center',
    });

    y += headerHeight;

    // Billing
    drawBillingBlock(doc, margin, y, leftWidth, billingHeight, billingFields);
    drawMetaTable(doc, margin + leftWidth, y, rightWidth, billingHeight, metaRows);

    y += billingHeight;

    // Items table
    const colDesc = pageWidth * 0.58;
    const colQty = pageWidth * 0.12;
    const colRate = pageWidth * 0.14;
    const colAmount = pageWidth - colDesc - colQty - colRate;
    const itemsHeaderHeight = 24;
    const itemsRowHeight = 56;

    drawBox(doc, margin, y, colDesc, itemsHeaderHeight, GREEN);
    drawBox(doc, margin + colDesc, y, colQty, itemsHeaderHeight, GREEN);
    drawBox(doc, margin + colDesc + colQty, y, colRate, itemsHeaderHeight, GREEN);
    drawBox(doc, margin + colDesc + colQty + colRate, y, colAmount, itemsHeaderHeight, GREEN);

    doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor(BLACK);
    doc.text('Item & Description', margin + 8, y + 7, { width: colDesc - 16 });
    doc.text('Quantity', margin + colDesc, y + 7, { width: colQty, align: 'center' });
    doc.text('Rate (AED)', margin + colDesc + colQty, y + 7, { width: colRate, align: 'center' });
    doc.text('Amount (AED)', margin + colDesc + colQty + colRate, y + 7, {
      width: colAmount,
      align: 'center',
    });

    y += itemsHeaderHeight;

    drawBox(doc, margin, y, colDesc, itemsRowHeight);
    drawBox(doc, margin + colDesc, y, colQty, itemsRowHeight);
    drawBox(doc, margin + colDesc + colQty, y, colRate, itemsRowHeight);
    drawBox(doc, margin + colDesc + colQty + colRate, y, colAmount, itemsRowHeight);

    doc.font('Helvetica').fontSize(FONT_SIZE);
    doc.text(description, margin + 8, y + 8, { width: colDesc - 16 });
    doc.text(participantLine, margin + 8, y + 26, { width: colDesc - 16 });
    doc.text(String(data.participantCount), margin + colDesc, y + 22, { width: colQty, align: 'center' });
    doc.text(data.unitPrice.toFixed(0), margin + colDesc + colQty, y + 22, {
      width: colRate,
      align: 'center',
    });
    doc.font('Helvetica-Bold');
    doc.text(data.subtotal.toFixed(0), margin + colDesc + colQty + colRate, y + 22, {
      width: colAmount,
      align: 'center',
    });

    y += itemsRowHeight;

    // Payment + totals
    const bottomHeight = 150;
    const paymentHeaderHeight = 22;
    const paymentBodyHeight = bottomHeight - paymentHeaderHeight;
    const totalsLabelWidth = rightWidth * 0.62;
    const totalsValueWidth = rightWidth - totalsLabelWidth;
    const totalRowHeight = bottomHeight / 3;

    drawBox(doc, margin, y, leftWidth, paymentHeaderHeight, GREEN);
    drawBox(doc, margin, y + paymentHeaderHeight, leftWidth, paymentBodyHeight);
    drawBox(doc, margin + leftWidth, y, rightWidth, bottomHeight);

    doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor(BLACK);
    doc.text('Payment Details:', margin + 8, y + 6, { lineBreak: false });

    doc.font('Helvetica-Bold');
    doc.text('In favor of:', margin + 8, y + paymentHeaderHeight + 8, { lineBreak: false });
    doc.font('Helvetica').fontSize(FONT_SIZE);
    let paymentY = y + paymentHeaderHeight + 22;
    for (const line of PAYMENT_DETAILS) {
      doc.text(line, margin + 8, paymentY, { width: leftWidth - 16 });
      paymentY += 12;
    }

    const totalRows: [string, string][] = [
      ['Total before VAT (AED)', data.subtotal.toFixed(2)],
      ['VAT (5%)', data.vatAmount.toFixed(2)],
      ['Grand total (AED)', data.totalAmount.toFixed(2)],
    ];

    for (let i = 0; i < totalRows.length; i++) {
      drawBox(doc, margin + leftWidth, y + i * totalRowHeight, totalsLabelWidth, totalRowHeight, GREEN);
    }
    drawHLine(doc, margin + leftWidth, y + totalRowHeight, rightWidth);
    drawHLine(doc, margin + leftWidth, y + totalRowHeight * 2, rightWidth);
    drawVLine(doc, margin + leftWidth + totalsLabelWidth, y, bottomHeight);

    totalRows.forEach(([label, value], index) => {
      const rowY = y + index * totalRowHeight;
      const textY = rowY + (totalRowHeight - FONT_SIZE) / 2;
      doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor(BLACK);
      doc.text(label, margin + leftWidth + 8, textY, {
        width: totalsLabelWidth - 16,
        lineBreak: false,
      });
      doc.text(value, margin + leftWidth + totalsLabelWidth + 8, textY, {
        width: totalsValueWidth - 16,
        align: 'right',
        lineBreak: false,
      });
    });

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
