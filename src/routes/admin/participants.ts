import { Router } from 'express';
import { pool, query, queryOne } from '../../db/pool.js';
import { adminImportParticipants } from '../../services/adminParticipantService.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const {
      workshop_id,
      role,
      search,
      organization_email,
      user_id,
      status,
      attendance_status,
      post_exam_status,
      cpd_status,
      roster_only,
      year,
      month,
    } = req.query;
    let sql = `
      SELECT p.*, w.title as workshop_title, w.start_date, w.end_date, w.time_slot,
             u.email as organization_email, u.role as organization_role,
             u.company as organization_company, u.name as organization_name,
             b.name as bank_name,
             i.invoice_number, i.total_amount as invoice_total, i.status as invoice_status,
             p.invitation_sent, p.certificate_sent
      FROM participants p
      LEFT JOIN workshops w ON w.id = p.workshop_id
      JOIN users u ON u.id = p.user_id
      LEFT JOIN banks b ON b.id = u.bank_id
      LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.status != 'cancelled'
    `;
    const params: unknown[] = [];

    if (req.user?.role === 'coordinator') {
      sql += ` AND u.created_by = ?`;
      params.push(req.user.id);
    }

    if (workshop_id) {
      sql += ` AND p.workshop_id = ?`;
      params.push(parseInt(workshop_id as string, 10));
    }

    if (user_id) {
      sql += ` AND p.user_id = ?`;
      params.push(parseInt(user_id as string, 10));
    }

    if (organization_email) {
      sql += ` AND u.email = ?`;
      params.push(String(organization_email).trim());
    }

    if (role) {
      const roles = String(role).split(',').map((r) => r.trim()).filter(Boolean);
      if (roles.length > 0) {
        sql += ` AND u.role IN (${roles.map(() => '?').join(', ')})`;
        params.push(...roles);
      }
    }

    if (search) {
      sql += ` AND (p.full_name LIKE ? OR p.email LIKE ? OR p.person_id LIKE ? OR u.email LIKE ? OR u.company LIKE ? OR b.name LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term, term);
    }

    if (status) {
      sql += ` AND p.status = ?`;
      params.push(String(status).trim());
    }

    if (attendance_status) {
      sql += ` AND p.attendance_status = ?`;
      params.push(String(attendance_status).trim());
    }

    if (post_exam_status) {
      sql += ` AND p.post_exam_status = ?`;
      params.push(String(post_exam_status).trim());
    }

    if (cpd_status) {
      sql += ` AND p.cpd_status = ?`;
      params.push(String(cpd_status).trim());
    }

    if (roster_only === '1' || roster_only === 'true') {
      sql += ` AND p.workshop_id IS NULL`;
    }

    if (year) {
      const yearNum = parseInt(String(year), 10);
      if (Number.isFinite(yearNum)) {
        sql += ` AND (w.start_date IS NULL OR YEAR(w.start_date) = ?)`;
        params.push(yearNum);
      }
    }

    if (month) {
      const monthNum = parseInt(String(month), 10);
      if (Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12) {
        sql += ` AND (w.start_date IS NULL OR MONTH(w.start_date) = ?)`;
        params.push(monthNum);
      }
    }

    sql += ` ORDER BY COALESCE(w.start_date, p.created_at) DESC, p.full_name ASC`;
    const participants = await query(sql, params);
    res.json(participants);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

router.post('/import', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Import rows are required' });
    }

    const result = await adminImportParticipants(rows);
    res.json({
      message: `${result.added} participant(s) imported`,
      ...result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Import failed' });
  }
});

const ATTENDANCE_STATUSES = new Set(['pending', 'present', 'absent']);
const POST_EXAM_STATUSES = new Set(['pending', 'passed', 'failed']);
const CPD_STATUSES = new Set(['pending', 'credited', 'not_credited']);

const PARTICIPANT_STATUSES = new Set(['pending', 'confirmed', 'cancelled']);

router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { full_name, email, phone, person_id, job_position, status } = req.body;

    const existing = await queryOne<{ id: number; user_id: number }>(
      `SELECT id, user_id FROM participants WHERE id = ?`,
      [id]
    );
    if (!existing) return res.status(404).json({ error: 'Participant not found' });

    if (req.user?.role === 'coordinator') {
      const partnerUserCheck = await queryOne<{ created_by: number | null }>(
        `SELECT created_by FROM users WHERE id = ?`,
        [existing.user_id]
      );
      if (!partnerUserCheck || partnerUserCheck.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Access denied: you did not create the associated partner user' });
      }
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (full_name !== undefined) {
      updates.push('full_name = ?');
      params.push(String(full_name).trim());
    }
    if (email !== undefined) {
      updates.push('email = ?');
      params.push(String(email).trim());
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone ? String(phone).trim() : null);
    }
    if (person_id !== undefined) {
      updates.push('person_id = ?');
      params.push(person_id ? String(person_id).trim() : null);
    }
    if (job_position !== undefined) {
      updates.push('job_position = ?');
      params.push(job_position ? String(job_position).trim() : null);
    }
    if (status !== undefined) {
      if (!PARTICIPANT_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    await pool.execute(`UPDATE participants SET ${updates.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    res.json({ message: 'Participant updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update participant' });
  }
});

router.patch('/:id/attendance', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { attended, attendance_status, post_exam_status, cpd_status } = req.body;

    if (req.user?.role === 'coordinator') {
      const participantUser = await queryOne<{ user_id: number }>(
        `SELECT user_id FROM participants WHERE id = ?`,
        [id]
      );
      if (participantUser) {
        const partnerUserCheck = await queryOne<{ created_by: number | null }>(
          `SELECT created_by FROM users WHERE id = ?`,
          [participantUser.user_id]
        );
        if (!partnerUserCheck || partnerUserCheck.created_by !== req.user.id) {
          return res.status(403).json({ error: 'Access denied: you did not create the associated partner user' });
        }
      }
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (attendance_status !== undefined) {
      if (!ATTENDANCE_STATUSES.has(attendance_status)) {
        return res.status(400).json({ error: 'Invalid attendance status' });
      }
      updates.push('attendance_status = ?', 'attended = ?');
      params.push(attendance_status, attendance_status === 'present' ? 1 : 0);
    } else if (attended !== undefined) {
      const status = attended ? 'present' : 'pending';
      updates.push('attendance_status = ?', 'attended = ?');
      params.push(status, attended ? 1 : 0);
    }

    if (post_exam_status !== undefined) {
      if (!POST_EXAM_STATUSES.has(post_exam_status)) {
        return res.status(400).json({ error: 'Invalid post exam status' });
      }
      updates.push('post_exam_status = ?');
      params.push(post_exam_status);
    }

    if (cpd_status !== undefined) {
      if (!CPD_STATUSES.has(cpd_status)) {
        return res.status(400).json({ error: 'Invalid CPD status' });
      }
      updates.push('cpd_status = ?');
      params.push(cpd_status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No status fields provided' });
    }

    params.push(id);
    await pool.execute(
      `UPDATE participants SET ${updates.join(', ')} WHERE id = ?`,
      params as (string | number)[]
    );
    res.json({ message: 'Participant status updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update attendance' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { user_id, workshop_id, full_name, email, phone, person_id, job_position } = req.body;
    if (!user_id || !full_name || !email) {
      return res.status(400).json({ error: 'User ID, Full Name, and Email are required' });
    }

    if (req.user?.role === 'coordinator') {
      const partnerUserCheck = await queryOne<{ created_by: number | null }>(
        `SELECT created_by FROM users WHERE id = ?`,
        [user_id]
      );
      if (!partnerUserCheck || partnerUserCheck.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Access denied: you did not create this partner user' });
      }
    }
    
    const { addParticipant } = await import('../../services/participantService.js');
    
    const partnerUser = await queryOne<{ id: number; email: string; name: string; role: string; company: string | null; bank_id: number | null }>(
      `SELECT id, email, name, role, company, bank_id FROM users WHERE id = ?`,
      [user_id]
    );
    if (!partnerUser) return res.status(404).json({ error: 'Partner coordinator not found' });
    
    const parsedWorkshopId = workshop_id ? parseInt(String(workshop_id), 10) : null;
    
    const id = await addParticipant({
      id: partnerUser.id,
      email: partnerUser.email,
      name: partnerUser.name,
      role: partnerUser.role as any,
      company: partnerUser.company,
      bank_id: partnerUser.bank_id,
    }, {
      ...(parsedWorkshopId ? { workshop_id: parsedWorkshopId } : {}),
      full_name,
      email,
      phone: phone || '',
      person_id: person_id || '',
      job_position: job_position || '',
    });
    
    res.status(201).json({ id, message: 'Participant added successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add participant' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { user_id, workshop_id, payment_method, participants } = req.body;
    if (!user_id || !workshop_id || !payment_method || !Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    if (req.user?.role === 'coordinator') {
      const partnerUserCheck = await queryOne<{ created_by: number | null }>(
        `SELECT created_by FROM users WHERE id = ?`,
        [user_id]
      );
      if (!partnerUserCheck || partnerUserCheck.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Access denied: you did not create this partner user' });
      }
    }
    
    const { registerWorkshopBooking } = await import('../../services/participantService.js');
    
    const partnerUser = await queryOne<{ id: number; email: string; name: string; role: string; company: string | null; bank_id: number | null }>(
      `SELECT id, email, name, role, company, bank_id FROM users WHERE id = ?`,
      [user_id]
    );
    if (!partnerUser) return res.status(404).json({ error: 'Partner coordinator not found' });
    
    const result = await registerWorkshopBooking({
      id: partnerUser.id,
      email: partnerUser.email,
      name: partnerUser.name,
      role: partnerUser.role as any,
      company: partnerUser.company,
      bank_id: partnerUser.bank_id,
    }, {
      workshop_id: parseInt(String(workshop_id), 10),
      payment_method,
      terms_accepted: true,
      participants,
    });
    
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed' });
  }
});

export default router;
