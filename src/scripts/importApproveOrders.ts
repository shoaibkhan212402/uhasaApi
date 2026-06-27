import { importOrderExportKind } from '../services/orderExportImportService.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const summary = await importOrderExportKind('approve', { dryRun, replace: true });
  console.log(JSON.stringify(summary, null, 2));
  if (Array.isArray(summary.failed) && summary.failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
