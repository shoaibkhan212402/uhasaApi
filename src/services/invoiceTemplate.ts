const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const UASA_TRN = '100547434900003';

const UASA_ADDRESS = [
  'P.O Box: 117555 – Dubai',
  'United Arab Emirates',
  'Tel: +971 4 290 0056',
  'Email: info@uasa.ae',
  `TRN: ${UASA_TRN}`,
];

const PAYMENT_DETAILS = [
  'Emirates Islamic Bank',
  'Khalidiya Branch',
  'Abu Dhabi – UAE',
  'Account Name: Union of Arab Securities Authorities',
  'Account No. : 3707381362101',
  'IBAN No. : AE730340003707381362101',
  'SWIFT code: MEBLAEAD',
  `TRN: ${UASA_TRN}`,
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

function formatInvoiceDate(value: string): string {
  const d = parseDate(value);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function addDays(value: string, days: number): string {
  const d = parseDate(value);
  d.setDate(d.getDate() + days);
  return formatInvoiceDate(d.toISOString());
}

function formatWorkshopDay(value: string): string {
  const d = parseDate(value);
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

export function formatWorkshopDateRange(startDate: string, endDate: string): string {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const startText = formatWorkshopDay(startDate);
  const endText = formatWorkshopDay(endDate);

  if (start.getTime() === end.getTime()) return startText;
  return `${startText} & ${endText}`;
}

export interface InvoiceData {
  invoiceNumber: string;
  billedTo: string;
  billedAddress?: string | null;
  billedTrn?: string | null;
  invoiceDate: string;
  paymentDueDate: string;
  workshopTitle: string;
  workshopFormat: string;
  workshopDates: string;
  participantCount: number;
  unitPrice: number;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
}

export function invoiceHtml(data: InvoiceData): string {
  const title = escapeHtml(data.workshopTitle);
  const format = escapeHtml(data.workshopFormat || 'Online');
  const dates = escapeHtml(data.workshopDates);
  const description = `Fees for &ldquo;${title}&rdquo; ${format} workshop -UAE, ${dates}`;
  const participantLine = `Participant: ${data.participantCount}`;
  const qty = data.participantCount;
  const rate = data.unitPrice.toFixed(0);
  const lineAmount = data.subtotal.toFixed(0);
  const subtotal = data.subtotal.toFixed(2);
  const vat = data.vatAmount.toFixed(2);
  const total = data.totalAmount.toFixed(2);

  const billedTo = escapeHtml(data.billedTo || '');
  const billedAddress = escapeHtml(data.billedAddress || '');
  const billedTrn = escapeHtml(data.billedTrn || '');
  const invoiceNumber = escapeHtml(data.invoiceNumber);
  const invoiceDate = escapeHtml(data.invoiceDate);
  const paymentDue = escapeHtml(data.paymentDueDate);

  const addressLines = UASA_ADDRESS.map((line) => `${escapeHtml(line)}<br />`).join('');
  const paymentLines = PAYMENT_DETAILS.map((line) => `${escapeHtml(line)}<br />`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tax Invoice ${invoiceNumber}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #000;
      background: #fff;
      font-size: 11px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      max-width: 190mm;
      margin: 0 auto;
      padding: 8px 0 24px;
    }
    table.layout {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    table.layout td,
    table.layout th {
      border: 1px solid #000;
      vertical-align: top;
      padding: 8px 10px;
    }
    .green {
      background: #c5e0b4;
      font-weight: 700;
    }
    .header-left {
      width: 58%;
      font-size: 11px;
      line-height: 1.45;
    }
    .header-left strong {
      display: block;
      margin-bottom: 4px;
      font-size: 12px;
    }
    .header-right {
      width: 42%;
      text-align: center;
      vertical-align: middle !important;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 0.02em;
      padding: 28px 10px !important;
    }
    .billing-left {
      width: 58%;
      font-size: 11px;
      line-height: 1.8;
      min-height: 72px;
    }
    .billing-left .label {
      font-weight: 700;
      display: inline-block;
      min-width: 72px;
    }
    .billing-right {
      width: 42%;
      padding: 0 !important;
    }
    .billing-right table {
      width: 100%;
      border-collapse: collapse;
      height: 100%;
    }
    .billing-right td {
      border: 1px solid #000;
      padding: 6px 10px;
      font-size: 11px;
    }
    .billing-right .label {
      font-weight: 700;
      width: 42%;
    }
    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-top: 0;
      font-size: 11px;
    }
    table.items th,
    table.items td {
      border: 1px solid #000;
      padding: 8px 10px;
      vertical-align: top;
    }
    table.items th {
      background: #c5e0b4;
      font-weight: 700;
      text-align: center;
    }
    table.items th.desc {
      text-align: left;
    }
    table.items td.num {
      text-align: center;
      white-space: nowrap;
    }
    table.items td.amount {
      text-align: center;
      font-weight: 700;
    }
    .item-sub {
      margin-top: 6px;
    }
    .bottom-row td {
      border: none !important;
      padding: 0 !important;
      vertical-align: top;
    }
    .payment-box {
      width: 58%;
      border: 1px solid #000;
      margin-top: 0;
    }
    .payment-box .payment-head {
      background: #c5e0b4;
      font-weight: 700;
      padding: 6px 10px;
      border-bottom: 1px solid #000;
    }
    .payment-box .payment-body {
      padding: 8px 10px 10px;
      font-size: 11px;
      line-height: 1.5;
    }
    .payment-box .payment-body .label {
      font-weight: 700;
    }
    .totals-wrap {
      width: 42%;
      padding-left: 0;
    }
    table.totals {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      margin-left: auto;
    }
    table.totals td {
      border: 1px solid #000;
      padding: 6px 10px;
    }
    table.totals td.label {
      background: #c5e0b4;
      font-weight: 700;
      width: 62%;
    }
    table.totals td.value {
      text-align: right;
      font-weight: 700;
      width: 38%;
    }
    @media screen and (max-width: 720px) {
      .header-right { font-size: 22px; padding: 18px 8px !important; }
      .bottom-row { display: block; }
      .payment-box, .totals-wrap { width: 100%; display: block; margin-top: 12px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <table class="layout">
      <tr>
        <td class="header-left">
          <strong>Union of Arab Securities Authorities</strong>
          ${addressLines}
        </td>
        <td class="header-right">TAX INVOICE</td>
      </tr>
      <tr>
        <td class="billing-left">
          <div><span class="label">Billed to:</span> ${billedTo}</div>
          <div><span class="label">Address:</span> ${billedAddress}</div>
          <div><span class="label">TRN:</span> ${billedTrn}</div>
        </td>
        <td class="billing-right">
          <table>
            <tr>
              <td class="label">Invoice number:</td>
              <td>${invoiceNumber}</td>
            </tr>
            <tr>
              <td class="label">Invoice date:</td>
              <td>${invoiceDate}</td>
            </tr>
            <tr>
              <td class="label">Payment due:</td>
              <td>${paymentDue}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table class="items">
      <thead>
        <tr>
          <th class="desc">Item &amp; Description</th>
          <th style="width:12%">Quantity</th>
          <th style="width:14%">Rate (AED)</th>
          <th style="width:16%">Amount (AED)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div>${description}</div>
            <div class="item-sub">${participantLine}</div>
          </td>
          <td class="num">${qty}</td>
          <td class="num">${rate}</td>
          <td class="amount">${lineAmount}</td>
        </tr>
      </tbody>
    </table>

    <table class="layout" style="margin-top:0">
      <tr class="bottom-row">
        <td style="width:58%; padding-top:0">
          <div class="payment-box">
            <div class="payment-head">Payment Details:</div>
            <div class="payment-body">
              <div class="label">In favor of:</div>
              ${paymentLines}
            </div>
          </div>
        </td>
        <td style="width:42%; padding-top:0">
          <table class="totals">
            <tr>
              <td class="label">Total before VAT (AED)</td>
              <td class="value">${subtotal}</td>
            </tr>
            <tr>
              <td class="label">VAT (5%)</td>
              <td class="value">${vat}</td>
            </tr>
            <tr>
              <td class="label">Grand total (AED)</td>
              <td class="value">${total}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}

export function buildInvoiceData(input: {
  invoiceNumber: string;
  createdAt: string;
  billedTo: string;
  billedAddress?: string | null;
  billedTrn?: string | null;
  workshopTitle: string;
  workshopFormat: string;
  startDate: string;
  endDate: string;
  participantCount: number;
  unitPrice: number;
}): InvoiceData {
  const participantCount = Math.max(1, input.participantCount);
  const subtotal = Math.round(input.unitPrice * participantCount * 100) / 100;
  const vatAmount = Math.round(subtotal * 0.05 * 100) / 100;
  const totalAmount = Math.round((subtotal + vatAmount) * 100) / 100;

  return {
    invoiceNumber: input.invoiceNumber,
    billedTo: input.billedTo,
    billedAddress: input.billedAddress,
    billedTrn: input.billedTrn,
    invoiceDate: formatInvoiceDate(input.createdAt),
    paymentDueDate: addDays(input.createdAt, 10),
    workshopTitle: input.workshopTitle,
    workshopFormat: input.workshopFormat,
    workshopDates: formatWorkshopDateRange(input.startDate, input.endDate),
    participantCount,
    unitPrice: input.unitPrice,
    subtotal,
    vatAmount,
    totalAmount,
  };
}
