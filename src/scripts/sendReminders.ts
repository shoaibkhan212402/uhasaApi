import { query, pool } from '../db/pool.js';
import { reminderEmailHtml, sendEmail, zoomEmailHtml } from '../services/emailService.js';

async function sendReminders() {
  const rows = await query<{
    id: number;
    email: string;
    full_name: string;
    workshop_title: string;
    start_date: string;
    time_slot: string;
    reminder_days_before: number;
  }>(
    `SELECT p.id, p.email, p.full_name, w.title as workshop_title, w.start_date, w.time_slot, w.reminder_days_before
     FROM participants p
     JOIN workshops w ON w.id = p.workshop_id
     WHERE p.status = 'confirmed' AND p.reminder_sent = 0
       AND w.end_date >= CURDATE()
       AND DATEDIFF(w.start_date, CURDATE()) <= w.reminder_days_before
       AND DATEDIFF(w.start_date, CURDATE()) >= 0`
  );

  let sent = 0;
  for (const row of rows) {
    const ok = await sendEmail({
      to: row.email,
      subject: `Reminder: ${row.workshop_title}`,
      html: reminderEmailHtml({
        participantName: row.full_name,
        workshopTitle: row.workshop_title,
        startDate: String(row.start_date).slice(0, 10),
        timeSlot: row.time_slot,
      }),
      templateType: 'reminder',
      participantId: row.id,
    });
    if (ok) {
      await pool.execute(`UPDATE participants SET reminder_sent = 1 WHERE id = ?`, [row.id]);
      sent++;
    }
  }
  return sent;
}

async function sendZoomLinks() {
  const rows = await query<{
    id: number;
    email: string;
    full_name: string;
    workshop_title: string;
    zoom_link: string;
  }>(
    `SELECT p.id, p.email, p.full_name, w.title as workshop_title, w.zoom_link
     FROM participants p
     JOIN workshops w ON w.id = p.workshop_id
     WHERE p.status = 'confirmed' AND p.zoom_sent = 0
       AND w.start_date = CURDATE()
       AND w.zoom_link IS NOT NULL AND w.zoom_link != ''`
  );

  let sent = 0;
  for (const row of rows) {
    const ok = await sendEmail({
      to: row.email,
      subject: `Zoom Link — ${row.workshop_title}`,
      html: zoomEmailHtml({
        participantName: row.full_name,
        workshopTitle: row.workshop_title,
        zoomLink: row.zoom_link,
      }),
      templateType: 'zoom',
      participantId: row.id,
    });
    if (ok) {
      await pool.execute(`UPDATE participants SET zoom_sent = 1 WHERE id = ?`, [row.id]);
      sent++;
    }
  }
  return sent;
}

async function archivePastWorkshops() {
  const [result] = await pool.execute(
    `UPDATE workshops SET is_published = 0 WHERE is_published = 1 AND end_date < CURDATE()`
  );
  return (result as { affectedRows: number }).affectedRows;
}

async function main() {
  console.log('Running scheduled email & workshop tasks...');
  const reminders = await sendReminders();
  const zooms = await sendZoomLinks();
  const archived = await archivePastWorkshops();
  console.log(`Reminders sent: ${reminders}, Zoom links sent: ${zooms}, Workshops archived: ${archived}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
