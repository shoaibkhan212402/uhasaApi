import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';

export type InvoiceExportColumn = {
  key: string;
  label: string;
  width?: number;
};

export const INVOICE_EXPORT_COLUMNS: InvoiceExportColumn[] = [
  { key: 'id', label: 'S.No', width: 40 },
  { key: 'invoice_number', label: 'InvoiceNo', width: 70 },
  { key: 'order_id', label: 'OrderId', width: 50 },
  { key: 'type', label: 'Type', width: 60 },
  { key: 'user_type', label: 'UserType', width: 65 },
  { key: 'status', label: 'Status', width: 55 },
  { key: 'participant_name', label: 'Participant', width: 90 },
  { key: 'workshop_title', label: 'Workshop', width: 110 },
  { key: 'amount', label: 'Amount', width: 55 },
  { key: 'vat_amount', label: 'VAT', width: 50 },
  { key: 'total_amount', label: 'Total', width: 55 },
  { key: 'created_at', label: 'Created', width: 75 },
];

export type InvoiceExportRow = Record<string, unknown>;

function displayInvoiceNumber(value: unknown): string {
  const str = String(value ?? '');
  if (!str || str.startsWith('SAMPLE-INV-')) return '';
  return str;
}

function formatMoney(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2);
}

function formatDate(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB');
}

export function mapInvoiceExportRows(rows: InvoiceExportRow[]): Record<string, string | number>[] {
  return rows.map((row) => ({
    id: Number(row.id),
    invoice_number: displayInvoiceNumber(row.invoice_number),
    order_id: Number(row.order_id),
    type: String(row.type ?? ''),
    user_type: String(row.user_type ?? ''),
    status: String(row.status ?? ''),
    participant_name: String(row.participant_name ?? ''),
    workshop_title: String(row.workshop_title ?? ''),
    amount: formatMoney(row.amount),
    vat_amount: formatMoney(row.vat_amount),
    total_amount: formatMoney(row.total_amount),
    created_at: formatDate(row.created_at),
  }));
}

function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function invoicesToCsv(rows: InvoiceExportRow[]): string {
  const mapped = mapInvoiceExportRows(rows);
  const header = INVOICE_EXPORT_COLUMNS.map((c) => escapeCsvCell(c.label)).join(',');
  const body = mapped.map((row) =>
    INVOICE_EXPORT_COLUMNS.map((c) => escapeCsvCell(row[c.key])).join(',')
  );
  return [header, ...body].join('\n');
}

export function invoicesToXlsx(rows: InvoiceExportRow[]): Buffer {
  const mapped = mapInvoiceExportRows(rows);
  const sheet = XLSX.utils.json_to_sheet(
    mapped.map((row) => {
      const labeled: Record<string, string | number> = {};
      for (const col of INVOICE_EXPORT_COLUMNS) {
        labeled[col.label] = row[col.key];
      }
      return labeled;
    })
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Invoices');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

export function invoicesToPdf(rows: InvoiceExportRow[], title = 'Invoice List'): Promise<Buffer> {
  const mapped = mapInvoiceExportRows(rows);
  const columns = INVOICE_EXPORT_COLUMNS;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const tableTop = 72;
    const rowHeight = 18;
    const headerHeight = 22;

    const totalWidth = columns.reduce((sum, col) => sum + (col.width ?? 60), 0);
    const scale = pageWidth / totalWidth;
    const colWidths = columns.map((col) => (col.width ?? 60) * scale);

    const drawHeader = (y: number) => {
      let x = doc.page.margins.left;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e293b');
      for (let i = 0; i < columns.length; i++) {
        doc.rect(x, y, colWidths[i], headerHeight).fillAndStroke('#f1f5f9', '#cbd5e1');
        doc.fillColor('#334155').text(columns[i].label, x + 4, y + 6, {
          width: colWidths[i] - 8,
          lineBreak: false,
          ellipsis: true,
        });
        x += colWidths[i];
      }
    };

    const drawRow = (row: Record<string, string | number>, y: number) => {
      let x = doc.page.margins.left;
      doc.font('Helvetica').fontSize(7).fillColor('#0f172a');
      for (let i = 0; i < columns.length; i++) {
        doc.rect(x, y, colWidths[i], rowHeight).stroke('#e2e8f0');
        doc.text(String(row[columns[i].key] ?? ''), x + 4, y + 5, {
          width: colWidths[i] - 8,
          lineBreak: false,
          ellipsis: true,
        });
        x += colWidths[i];
      }
    };

    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a');
    doc.text(title, doc.page.margins.left, 36);
    doc.font('Helvetica').fontSize(9).fillColor('#64748b');
    doc.text(`Generated ${new Date().toLocaleString('en-GB')} · ${mapped.length} record(s)`, doc.page.margins.left, 54);

    let y = tableTop;
    drawHeader(y);
    y += headerHeight;

    for (const row of mapped) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader(y);
        y += headerHeight;
      }
      drawRow(row, y);
      y += rowHeight;
    }

    doc.end();
  });
}
