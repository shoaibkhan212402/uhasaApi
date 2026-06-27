import {
  importAllOrderExports,
  importOrderExportKind,
  type OrderExportKind,
} from '../services/orderExportImportService.js';

const KIND_ALIASES: Record<string, OrderExportKind> = {
  approve: 'approve',
  'approve-orders': 'approve',
  online: 'online-paid',
  'online-paid': 'online-paid',
  'online-paid-orders': 'online-paid',
  corporate: 'corporate',
  'corporate-orders': 'corporate',
  bank: 'bank',
  'bank-orders': 'bank',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const all = process.argv.includes('--all');
  const kindArg = process.argv.find((arg) => KIND_ALIASES[arg]);

  if (all || !kindArg) {
    const summary = await importAllOrderExports({ dryRun, replaceApprove: true });
    console.log(JSON.stringify(summary, null, 2));
    const imports = summary.imports as Record<string, { failed?: string[] }>;
    const hasFailures = Object.values(imports).some(
      (entry) => Array.isArray(entry?.failed) && entry.failed.length > 0
    );
    if (hasFailures) process.exitCode = 1;
    return;
  }

  const kind = KIND_ALIASES[kindArg];
  const replace = kind === 'approve';
  const summary = await importOrderExportKind(kind, { dryRun, replace });
  console.log(JSON.stringify(summary, null, 2));
  if (Array.isArray(summary.failed) && summary.failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
