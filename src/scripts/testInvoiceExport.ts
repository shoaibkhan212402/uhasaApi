import { fetchInvoicesForExport } from '../services/invoiceQuery.js';
import { invoicesToCsv, invoicesToPdf, invoicesToXlsx, type InvoiceExportRow } from '../services/invoiceExportService.js';
import { pool } from '../db/pool.js';

async function main() {
  const rows = (await fetchInvoicesForExport({})) as InvoiceExportRow[];
  console.log('rows', rows.length);
  console.log('csv bytes', invoicesToCsv(rows).length);
  console.log('xlsx bytes', invoicesToXlsx(rows).length);
  const pdf = await invoicesToPdf(rows);
  console.log('pdf bytes', pdf.length);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
