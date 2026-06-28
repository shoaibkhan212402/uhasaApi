import { Router } from 'express';
import { insert, pool, query, queryOne } from '../../db/pool.js';

const router = Router();

const WORKSHOP_LANGUAGES = ['English', 'Arabic', 'Both'] as const;

function normalizeWorkshopLanguage(language: unknown): string | null {
  if (typeof language !== 'string') return null;
  const trimmed = language.trim();
  return WORKSHOP_LANGUAGES.includes(trimmed as (typeof WORKSHOP_LANGUAGES)[number]) ? trimmed : null;
}

router.get('/', async (_req, res) => {
  try {
    const workshops = await query(
      `SELECT w.*,
        COALESCE(corp_reg.seats, 0) + COALESCE(corp_part.cnt, 0) AS corporate_participants,
        COALESCE(bank_reg.seats, 0) + COALESCE(bank_part.cnt, 0) AS bank_participants,
        COALESCE(reg_seats.seats, 0) + COALESCE(portal_seats.cnt, 0) AS registered_seats,
        GREATEST(
          w.total_seats - (COALESCE(reg_seats.seats, 0) + COALESCE(portal_seats.cnt, 0)),
          0
        ) AS left_seats
       FROM workshops w
       LEFT JOIN (
         SELECT workshop_id, SUM(COALESCE(total_seats, 1)) AS seats
         FROM registrations
         WHERE registration_type = 'Corporate' AND status != 'cancelled'
         GROUP BY workshop_id
       ) corp_reg ON corp_reg.workshop_id = w.id
       LEFT JOIN (
         SELECT workshop_id, SUM(COALESCE(total_seats, 1)) AS seats
         FROM registrations
         WHERE registration_type = 'Bank' AND status != 'cancelled'
         GROUP BY workshop_id
       ) bank_reg ON bank_reg.workshop_id = w.id
       LEFT JOIN (
         SELECT p.workshop_id, COUNT(*) AS cnt
         FROM participants p
         JOIN users u ON u.id = p.user_id
         WHERE p.status != 'cancelled' AND u.role = 'corporate'
         GROUP BY p.workshop_id
       ) corp_part ON corp_part.workshop_id = w.id
       LEFT JOIN (
         SELECT p.workshop_id, COUNT(*) AS cnt
         FROM participants p
         JOIN users u ON u.id = p.user_id
         WHERE p.status != 'cancelled' AND u.role = 'bank'
         GROUP BY p.workshop_id
       ) bank_part ON bank_part.workshop_id = w.id
       LEFT JOIN (
         SELECT workshop_id, SUM(COALESCE(total_seats, 1)) AS seats
         FROM registrations
         WHERE status != 'cancelled'
         GROUP BY workshop_id
       ) reg_seats ON reg_seats.workshop_id = w.id
       LEFT JOIN (
         SELECT workshop_id, COUNT(*) AS cnt
         FROM participants
         WHERE status != 'cancelled'
         GROUP BY workshop_id
       ) portal_seats ON portal_seats.workshop_id = w.id
       ORDER BY w.start_date DESC`
    );
    res.json(workshops);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch workshops' });
  }
});

async function getRegisteredSeats(workshopId: number): Promise<number> {
  const regRow = await queryOne<{ seats: number }>(
    `SELECT COALESCE(SUM(COALESCE(total_seats, 1)), 0) AS seats
     FROM registrations WHERE workshop_id = ? AND status != 'cancelled'`,
    [workshopId]
  );
  const portalRow = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM participants WHERE workshop_id = ? AND status != 'cancelled'`,
    [workshopId]
  );
  return (regRow?.seats || 0) + (portalRow?.cnt || 0);
}

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const workshop = await queryOne(`SELECT * FROM workshops WHERE id = ?`, [id]);
    if (!workshop) return res.status(404).json({ error: 'Not found' });

    const sections = await query(
      `SELECT * FROM workshop_sections WHERE workshop_id = ? ORDER BY sort_order`,
      [id]
    );
    const registered_seats = await getRegisteredSeats(id);
    res.json({ ...workshop, sections, registered_seats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch workshop' });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const language = normalizeWorkshopLanguage(b.language);
    if (!language) {
      return res.status(400).json({ error: 'Invalid workshop language. Choose English, Arabic, or Both.' });
    }
    const id = await insert(
      `INSERT INTO workshops (title, title_2, category, cpd_hours, start_date, end_date, time_slot, language, format, image_url, description, price, total_seats, cto_cma_limit, cma_limit, hct_limit, zoom_link, invitation_program_label, invitation_subtitle, meeting_id, meeting_passcode, training_materials_url, pre_assessment_url, post_assessment_url, invitation_banner_url, certificate_note, reminder_days_before, is_published, display_order, registration_open)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.title, b.title_2 || null, b.category, b.cpd_hours || 0, b.start_date, b.end_date,
        b.time_slot || '', language, b.format || 'Online',
        b.image_url || null, b.description || null, b.price ?? 1950,
        b.total_seats ?? 40, b.cto_cma_limit ?? 3,
        b.cma_limit === undefined || b.cma_limit === null || b.cma_limit === '' ? null : Number(b.cma_limit),
        b.hct_limit === undefined || b.hct_limit === null || b.hct_limit === '' ? null : Number(b.hct_limit),
        b.zoom_link || null,
        b.invitation_program_label || 'Online CPD Program', b.invitation_subtitle || null,
        b.meeting_id || null, b.meeting_passcode || null,
        b.training_materials_url || null, b.pre_assessment_url || null, b.post_assessment_url || null,
        b.invitation_banner_url || null, b.certificate_note || null,
        b.reminder_days_before ?? 1, b.is_published !== false ? 1 : 0,
        b.display_order ?? 0, b.registration_open !== false ? 1 : 0,
      ]
    );

    if (b.sections?.length) {
      for (const s of b.sections) {
        await insert(
          `INSERT INTO workshop_sections (workshop_id, section_key, title, content, sort_order) VALUES (?, ?, ?, ?, ?)`,
          [id, s.section_key, s.title, s.content, s.sort_order ?? 0]
        );
      }
    }

    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create workshop' });
  }
});

router.patch('/:id/left-seats', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const leftSeats = parseInt(req.body?.left_seats, 10);
    if (!Number.isFinite(leftSeats) || leftSeats < 0) {
      return res.status(400).json({ error: 'left_seats must be a non-negative number' });
    }

    const workshop = await queryOne<{ id: number }>(`SELECT id FROM workshops WHERE id = ?`, [id]);
    if (!workshop) return res.status(404).json({ error: 'Not found' });

    const registeredSeats = await getRegisteredSeats(id);
    const newTotal = registeredSeats + leftSeats;
    await pool.execute(`UPDATE workshops SET total_seats = ? WHERE id = ?`, [newTotal, id]);
    res.json({
      total_seats: newTotal,
      left_seats: leftSeats,
      registered_seats: registeredSeats,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update left seats' });
  }
});

router.patch('/:id/seats', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const extraSeats = parseInt(req.body?.extra_seats, 10);
    if (!Number.isFinite(extraSeats) || extraSeats <= 0) {
      return res.status(400).json({ error: 'extra_seats must be a positive number' });
    }

    const workshop = await queryOne<{ id: number; total_seats: number; end_date: string }>(
      `SELECT id, total_seats, end_date FROM workshops WHERE id = ?`,
      [id]
    );
    if (!workshop) return res.status(404).json({ error: 'Not found' });

    const endDate = new Date(workshop.end_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (endDate < today) {
      return res.status(400).json({ error: 'Cannot add seats to a workshop that has already ended' });
    }

    const newTotal = workshop.total_seats + extraSeats;
    await pool.execute(`UPDATE workshops SET total_seats = ? WHERE id = ?`, [newTotal, id]);
    res.json({ total_seats: newTotal, added: extraSeats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add seats' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    const language = normalizeWorkshopLanguage(b.language);
    if (!language) {
      return res.status(400).json({ error: 'Invalid workshop language. Choose English, Arabic, or Both.' });
    }

    const registeredSeats = await getRegisteredSeats(id);
    if (typeof b.total_seats === 'number' && b.total_seats < registeredSeats) {
      return res.status(400).json({
        error: `Total seats cannot be less than registered seats (${registeredSeats})`,
      });
    }

    await pool.execute(
      `UPDATE workshops SET title=?, title_2=?, category=?, cpd_hours=?, start_date=?, end_date=?, time_slot=?, language=?, format=?, image_url=?, description=?, price=?, total_seats=?, cto_cma_limit=?, cma_limit=?, hct_limit=?, zoom_link=?, invitation_program_label=?, invitation_subtitle=?, meeting_id=?, meeting_passcode=?, training_materials_url=?, pre_assessment_url=?, post_assessment_url=?, invitation_banner_url=?, certificate_note=?, reminder_days_before=?, is_published=?, display_order=?, registration_open=? WHERE id=?`,
      [
        b.title, b.title_2 || null, b.category, b.cpd_hours, b.start_date, b.end_date,
        b.time_slot, language, b.format, b.image_url, b.description,
        b.price, b.total_seats, b.cto_cma_limit ?? 3,
        b.cma_limit === undefined || b.cma_limit === null || b.cma_limit === '' ? null : Number(b.cma_limit),
        b.hct_limit === undefined || b.hct_limit === null || b.hct_limit === '' ? null : Number(b.hct_limit),
        b.zoom_link || null,
        b.invitation_program_label || 'Online CPD Program', b.invitation_subtitle || null,
        b.meeting_id || null, b.meeting_passcode || null,
        b.training_materials_url || null, b.pre_assessment_url || null, b.post_assessment_url || null,
        b.invitation_banner_url || null, b.certificate_note || null,
        b.reminder_days_before ?? 1, b.is_published ? 1 : 0,
        b.display_order ?? 0, b.registration_open !== false ? 1 : 0, id,
      ]
    );

    if (b.sections) {
      await pool.execute(`DELETE FROM workshop_sections WHERE workshop_id = ?`, [id]);
      for (const s of b.sections) {
        await insert(
          `INSERT INTO workshop_sections (workshop_id, section_key, title, content, sort_order) VALUES (?, ?, ?, ?, ?)`,
          [id, s.section_key, s.title, s.content, s.sort_order ?? 0]
        );
      }
    }

    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update workshop' });
  }
});

router.patch('/:id/limits', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    const cma_limit = b.cma_limit === undefined || b.cma_limit === null || b.cma_limit === '' ? null : Number(b.cma_limit);
    const hct_limit = b.hct_limit === undefined || b.hct_limit === null || b.hct_limit === '' ? null : Number(b.hct_limit);
    await pool.execute(
      `UPDATE workshops SET cma_limit = ?, hct_limit = ? WHERE id = ?`,
      [cma_limit, hct_limit, id]
    );
    res.json({ message: 'Limits updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update limits' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.execute(`DELETE FROM workshops WHERE id = ?`, [id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete workshop' });
  }
});

export default router;
