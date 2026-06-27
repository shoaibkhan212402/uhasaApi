import { query, pool } from '../db/pool.js';
import { fulfillIndividualRegistration } from '../services/individualRegistrationService.js';

async function main() {
  const rows = await query<{ id: number; full_name: string; email: string; status: string }>(
    `SELECT r.id, r.full_name, r.email, r.status
     FROM registrations r
     WHERE r.registration_type = 'Individual'
       AND r.status != 'cancelled'
       AND NOT EXISTS (
         SELECT 1 FROM participants p
         JOIN users u ON u.id = p.user_id
         WHERE p.workshop_id = r.workshop_id
           AND p.email = r.email
           AND p.status != 'cancelled'
           AND u.email = 'individual-registrations@uasatraining.internal'
       )
     ORDER BY r.id`
  );

  if (rows.length === 0) {
    console.log('No individual registrations need backfill.');
    await pool.end();
    return;
  }

  console.log(`Backfilling ${rows.length} individual registration(s)...\n`);

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await fulfillIndividualRegistration(row.id);
      console.log(`✓ #${row.id} ${row.full_name} <${row.email}> (${row.status})`);
      ok++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`✗ #${row.id} ${row.full_name}: ${message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${ok} fulfilled, ${failed} failed.`);
  await pool.end();
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
