import { Router, Request } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { pool } from '../../db/pool.js';
import { portalRequired } from '../../middleware/auth.js';
import {
  addParticipant,
  listParticipants,
  listParticipantRoster,
  getParticipantCountForWorkshop,
  parseParticipantSpreadsheet,
  bulkAddParticipants,
  updateParticipant,
  bulkCancelParticipants,
  listArchivedParticipants,
  restoreParticipants,
} from '../../services/participantService.js';
import type { PortalUser } from '../../services/participantService.js';

const router = Router();

const uploadDir = path.join(os.tmpdir(), 'uasa-participant-imports');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) or CSV files are allowed'));
    }
  },
});

function toPortalUser(req: Request): PortalUser {
  const u = req.user!;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as PortalUser['role'],
    company: u.company || null,
    bank_id: u.bank_id || null,
  };
}

router.get('/', portalRequired, async (req, res) => {
  try {
    const workshopId = req.query.workshop_id ? parseInt(String(req.query.workshop_id), 10) : undefined;
    const participants = await listParticipants(req.user!.id, workshopId);
    res.json(participants);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

router.get('/roster', portalRequired, async (req, res) => {
  try {
    const workshopId = req.query.workshop_id
      ? parseInt(String(req.query.workshop_id), 10)
      : undefined;
    const roster = await listParticipantRoster(req.user!.id, workshopId);
    res.json(roster);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch participant roster' });
  }
});

router.get('/limits/:workshopId', portalRequired, async (req, res) => {
  try {
    const workshopId = parseInt(req.params.workshopId, 10);
    const count = await getParticipantCountForWorkshop(req.user!.id, workshopId);
    const { queryOne } = await import('../../db/pool.js');
    const workshop = await queryOne<{ cto_cma_limit: number }>(
      `SELECT cto_cma_limit FROM workshops WHERE id = ?`,
      [workshopId]
    );
    const role = req.user!.role;
    const limit = role === 'cto' || role === 'cma' ? (workshop?.cto_cma_limit ?? 3) : null;
    res.json({ count, limit, remaining: limit !== null ? Math.max(0, limit - count) : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch limits' });
  }
});

router.post('/', portalRequired, async (req, res) => {
  try {
    const { workshop_id, full_name, email, phone, person_id, job_position } = req.body;
    if (!full_name || !email || !phone || !person_id || !job_position) {
      return res.status(400).json({
        error: 'Person ID, Full Name, Job Position, Email Address, and Mobile Number are required',
      });
    }

    const parsedWorkshopId =
      workshop_id !== undefined && workshop_id !== null && workshop_id !== ''
        ? parseInt(String(workshop_id), 10)
        : null;

    if (parsedWorkshopId !== null && (!Number.isFinite(parsedWorkshopId) || parsedWorkshopId <= 0)) {
      return res.status(400).json({ error: 'Invalid workshop' });
    }

    const id = await addParticipant(toPortalUser(req), {
      ...(parsedWorkshopId ? { workshop_id: parsedWorkshopId } : {}),
      full_name,
      email,
      phone,
      person_id,
      job_position,
    });

    res.status(201).json({ id, message: 'Participant registered successfully' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add participant';
    const status =
      message.includes('limit') || message.includes('seats') || message.includes('already') || message.includes('not found')
        ? 400
        : 500;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

router.post('/import', portalRequired, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'Excel or CSV file is required' });
  }

  const workshopIdRaw = req.body.workshop_id;
  const workshopId =
    workshopIdRaw !== undefined && workshopIdRaw !== null && workshopIdRaw !== ''
      ? parseInt(String(workshopIdRaw), 10)
      : null;

  if (workshopId !== null && (!Number.isFinite(workshopId) || workshopId <= 0)) {
    fs.unlink(file.path, () => undefined);
    return res.status(400).json({ error: 'Invalid workshop' });
  }

  try {
    const buffer = fs.readFileSync(file.path);
    const rows = parseParticipantSpreadsheet(buffer);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No participant rows found in the uploaded file' });
    }

    const result = await bulkAddParticipants(toPortalUser(req), workshopId, rows);
    res.json({
      message: `${result.added} participant(s) enrolled successfully`,
      ...result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
  } finally {
    fs.unlink(file.path, () => undefined);
  }
});

router.patch('/:id', portalRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { full_name, email, phone, person_id, job_position, workshop_id } = req.body;

    if (!full_name || !email || !phone || !person_id || !job_position) {
      return res.status(400).json({
        error: 'Person ID, Full Name, Job Position, Email Address, and Mobile Number are required',
      });
    }

    const parsedWorkshopId =
      workshop_id === null
        ? null
        : workshop_id !== undefined
          ? parseInt(String(workshop_id), 10)
          : undefined;

    await updateParticipant(req.user!.id, req.user!.role, id, {
      full_name,
      email,
      phone,
      person_id,
      job_position,
      workshop_id:
        parsedWorkshopId === null
          ? null
          : Number.isFinite(parsedWorkshopId)
            ? parsedWorkshopId
            : undefined,
    });

    res.json({ message: 'Participant updated successfully' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update participant';
    const status =
      message.includes('not found') ||
      message.includes('already') ||
      message.includes('Cannot') ||
      message.includes('limit') ||
      message.includes('seats') ||
      message.includes('available')
        ? 400
        : 500;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

router.get('/archive', portalRequired, async (req, res) => {
  try {
    const participants = await listArchivedParticipants(req.user!.id);
    res.json(participants);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch archived participants' });
  }
});

router.post('/bulk-restore', portalRequired, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.map((id: unknown) => parseInt(String(id), 10)).filter((id: number) => id > 0)
      : [];

    const { restored, errors } = await restoreParticipants(req.user!.id, req.user!.role, ids);
    res.json({
      message:
        errors.length > 0
          ? `${restored} participant(s) restored. ${errors.length} could not be restored.`
          : `${restored} participant(s) restored`,
      restored,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bulk restore failed';
    const status = message.includes('No ') ? 400 : 500;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

router.post('/bulk-cancel', portalRequired, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.map((id: unknown) => parseInt(String(id), 10)).filter((id: number) => id > 0)
      : [];

    const cancelled = await bulkCancelParticipants(req.user!.id, ids);
    res.json({ message: `${cancelled} participant(s) archived`, cancelled });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bulk cancel failed';
    const status = message.includes('No participants') ? 400 : 500;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

router.delete('/:id', portalRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [result] = await pool.execute(
      `UPDATE participants SET status = 'cancelled', archived_at = NOW() WHERE id = ? AND user_id = ?`,
      [id, req.user!.id]
    );
    const affected = (result as { affectedRows: number }).affectedRows;
    if (!affected) return res.status(404).json({ error: 'Participant not found' });
    res.json({ message: 'Participant archived' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel participant' });
  }
});

export default router;
