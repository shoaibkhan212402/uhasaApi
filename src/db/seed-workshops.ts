import mysql from 'mysql2/promise';
import { config } from '../config.js';
import {
  CALENDAR_SYNC_RANGES,
  TIME_SLOT,
  type CalendarWorkshop,
} from './workshopsCalendar.js';

const DEFAULT_SECTIONS = [
  { key: 'how_to_join', title: 'How to Join', content: '<p>Register through the portal or contact our training team. Payment confirms your seat.</p>' },
  { key: 'objectives', title: 'Workshop Objectives', content: '<ul><li>Understand regulatory requirements</li><li>Apply best practices in daily operations</li><li>Earn accredited CPD hours</li></ul>' },
  { key: 'target_audiences', title: 'Target Audiences', content: '<p>Compliance officers, risk managers, auditors, and financial services professionals.</p>' },
  { key: 'qualifications', title: 'Qualifications', content: '<p>Open to professionals with a background in finance, accounting, or law.</p>' },
  { key: 'language_duration', title: 'Workshop Language and Duration', content: '' },
  { key: 'agenda', title: 'Daily Agenda', content: '<p><strong>Day 1:</strong> Regulatory overview and case studies<br/><strong>Day 2:</strong> Practical workshops and assessment</p>' },
  { key: 'details', title: 'Workshop Details', content: '<p>Materials provided digitally. Certificate issued upon completion.</p>' },
  { key: 'duration', title: 'Duration', content: '' },
];

function workshopKey(w: CalendarWorkshop): string {
  return `${w.start_date}|${w.title}`;
}

async function upsertWorkshop(connection: mysql.Connection, w: CalendarWorkshop): Promise<number> {
  const [existing] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id FROM workshops WHERE title = ? AND start_date = ? LIMIT 1`,
    [w.title, w.start_date]
  );

  if (existing[0]?.id) {
    const id = existing[0].id as number;
    await connection.query(
      `UPDATE workshops SET
         category = ?, cpd_hours = ?, end_date = ?, time_slot = ?,
         language = 'English', format = 'Online', image_url = NULL,
         is_published = 1
       WHERE id = ?`,
      [w.category, w.cpd_hours, w.end_date, TIME_SLOT, id]
    );
    return id;
  }

  const [result] = await connection.query<mysql.ResultSetHeader>(
    `INSERT INTO workshops
       (title, category, cpd_hours, start_date, end_date, time_slot, language, format,
        image_url, price, total_seats, cto_cma_limit, reminder_days_before, is_published)
     VALUES (?, ?, ?, ?, ?, ?, 'English', 'Online', NULL, 1950.00, 30, 3, 1, 1)`,
    [w.title, w.category, w.cpd_hours, w.start_date, w.end_date, TIME_SLOT]
  );
  return result.insertId;
}

async function ensureSections(connection: mysql.Connection, workshopId: number): Promise<void> {
  for (const [i, section] of DEFAULT_SECTIONS.entries()) {
    await connection.query(
      `INSERT INTO workshop_sections (workshop_id, section_key, title, content, sort_order)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content), sort_order = VALUES(sort_order)`,
      [workshopId, section.key, section.title, section.content, i]
    );
  }
}

async function syncRange(
  connection: mysql.Connection,
  from: string,
  to: string,
  workshops: CalendarWorkshop[]
): Promise<{ inserted: number; updated: number; removed: number }> {
  const targetKeys = new Set(workshops.map(workshopKey));
  let inserted = 0;
  let updated = 0;

  const [existingRows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id, title, start_date FROM workshops WHERE start_date >= ? AND start_date <= ?`,
    [from, to]
  );

  const toRemove = existingRows.filter((row) => !targetKeys.has(`${row.start_date}|${row.title}`));
  if (toRemove.length > 0) {
    const ids = toRemove.map((row) => row.id);
    await connection.query(`DELETE FROM workshops WHERE id IN (?)`, [ids]);
  }

  for (const w of workshops) {
    const [before] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id FROM workshops WHERE title = ? AND start_date = ? LIMIT 1`,
      [w.title, w.start_date]
    );
    const id = await upsertWorkshop(connection, w);
    await ensureSections(connection, id);
    if (before[0]?.id) updated++;
    else inserted++;
  }

  return { inserted, updated, removed: toRemove.length };
}

async function seedWorkshops() {
  const monthsArg = process.argv.find((a) => a.startsWith('--months='));
  const monthKeys = monthsArg
    ? monthsArg.replace('--months=', '').split(',').map((m) => m.trim().toLowerCase())
    : Object.keys(CALENDAR_SYNC_RANGES);

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  console.log(`Syncing workshops for: ${monthKeys.join(', ')}`);

  for (const key of monthKeys) {
    const range = CALENDAR_SYNC_RANGES[key as keyof typeof CALENDAR_SYNC_RANGES];
    if (!range) {
      console.warn(`Unknown month key: ${key}`);
      continue;
    }
    const result = await syncRange(connection, range.from, range.to, [...range.workshops]);
    console.log(
      `${key}: ${range.workshops.length} workshops — ${result.inserted} inserted, ${result.updated} updated, ${result.removed} removed`
    );
  }

  await connection.end();
  console.log('Workshop calendar sync complete.');
}

seedWorkshops().catch((err) => {
  console.error('Workshop sync failed:', err);
  process.exit(1);
});
