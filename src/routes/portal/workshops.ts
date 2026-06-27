import { Router, Request } from 'express';
import { query } from '../../db/pool.js';
import { portalRequired } from '../../middleware/auth.js';
import {
  registerWorkshopBooking,
  type PortalUser,
} from '../../services/participantService.js';

const router = Router();

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
    const idsParam = req.query.ids ? String(req.query.ids) : '';
    const ids = idsParam
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => Number.isFinite(id) && id > 0);

    let sql = `SELECT id, title, category, cpd_hours, start_date, end_date, time_slot, language, format, price, total_seats, cto_cma_limit, image_url
       FROM workshops WHERE is_published = 1`;
    const params: number[] = [];
    const includePast = req.query.include_past === '1' || req.query.include_past === 'true';

    if (!includePast) {
      sql += ` AND end_date >= CURDATE()`;
    }

    if (ids.length > 0) {
      sql += ` AND id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }

    sql += ` ORDER BY start_date ASC`;
    const workshops = await query(sql, params);
    res.json(workshops);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch workshops' });
  }
});

router.post('/:workshopId/register', portalRequired, async (req, res) => {
  try {
    const workshopId = parseInt(req.params.workshopId, 10);
    if (!Number.isFinite(workshopId) || workshopId <= 0) {
      return res.status(400).json({ error: 'Invalid workshop' });
    }

    const { participants, payment_method, terms_accepted } = req.body;

    if (!Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ error: 'At least one participant is required' });
    }

    if (payment_method !== 'bank_transfer' && payment_method !== 'online') {
      return res.status(400).json({ error: 'Valid payment method is required' });
    }

    const result = await registerWorkshopBooking(toPortalUser(req), {
      workshop_id: workshopId,
      participants,
      payment_method,
      terms_accepted: Boolean(terms_accepted),
    });

    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    const status =
      message.includes('terms') ||
      message.includes('participant') ||
      message.includes('limit') ||
      message.includes('seats') ||
      message.includes('not found') ||
      message.includes('already')
        ? 400
        : 500;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

export default router;
