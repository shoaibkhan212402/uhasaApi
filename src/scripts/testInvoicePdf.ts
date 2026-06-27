import { writeFileSync } from 'fs';
import { buildInvoiceData } from '../services/invoiceTemplate.js';
import { invoiceDataToPdf } from '../services/invoicePdfService.js';

const data = buildInvoiceData({
  invoiceNumber: '0081-2026',
  createdAt: '2026-06-16T00:00:00.000Z',
  billedTo: 'AHW',
  billedAddress: 'Dubai',
  billedTrn: 'HK525215255',
  workshopTitle: 'Fraud and Ethics',
  workshopFormat: 'Online',
  startDate: '2026-09-30',
  endDate: '2026-09-30',
  participantCount: 1,
  unitPrice: 1950,
});

const pdf = await invoiceDataToPdf(data);
writeFileSync('test-invoice.pdf', pdf);
console.log('Wrote test-invoice.pdf', pdf.length, 'bytes');
