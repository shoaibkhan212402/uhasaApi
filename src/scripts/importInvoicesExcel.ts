import { importInvoicesExcel } from '../services/invoiceExcelImportService.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const summary = await importInvoicesExcel({ dryRun });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
