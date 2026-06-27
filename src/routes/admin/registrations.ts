import { Router } from 'express';
import { pool, query, queryOne } from '../../db/pool.js';
import { adminImportRegistrations } from '../../services/adminRegistrationService.js';
import { fulfillIndividualRegistration } from '../../services/individualRegistrationService.js';

const router = Router();

const REGISTRATION_STATUSES = new Set(['pending', 'confirmed', 'cancelled']);

async function maybeFulfillIndividualRegistration(id: number, status: string) {
  if (status !== 'confirmed') return;

  try {
    await fulfillIndividualRegistration(id);
  } catch (err) {
    console.error(`Individual registration fulfillment failed for id ${id}:`, err);
  }
}

router.get('/', async (req, res) => {
  try {
    const { workshop_id, status, search, registration_type } = req.query;
    let sql = `
      SELECT r.*, w.title as workshop_title
      FROM registrations r
      LEFT JOIN workshops w ON w.id = r.workshop_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (req.user?.role === 'coordinator') {
      sql += ` AND (r.created_by = ? OR r.email IN (SELECT email FROM users WHERE created_by = ?))`;
      params.push(req.user.id, req.user.id);
    }

    if (workshop_id) {
      sql += ` AND r.workshop_id = ?`;
      params.push(parseInt(workshop_id as string, 10));
    }
    if (status) {
      sql += ` AND r.status = ?`;
      params.push(status);
    }
    if (registration_type) {
      sql += ` AND r.registration_type = ?`;
      params.push(registration_type);
    }
    if (search) {
      sql += ` AND (r.full_name LIKE ? OR r.email LIKE ? OR r.company LIKE ? OR r.invoice_number LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    sql += ` ORDER BY r.id DESC`;
    const registrations = await query(sql, params);
    res.json(registrations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
});

router.post('/import', async (req, res) => {
  try {
    const { rows, default_type } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Import rows are required' });
    }

    const result = await adminImportRegistrations(rows, default_type, req.user?.id);
    res.json({
      message: `${result.added} order(s) imported`,
      ...result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Import failed' });
  }
});

router.patch('/bulk-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Order ids are required' });
    }
    if (!REGISTRATION_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const numericIds = ids
      .map((id: unknown) => parseInt(String(id), 10))
      .filter((id: number) => Number.isFinite(id) && id > 0);

    if (numericIds.length === 0) {
      return res.status(400).json({ error: 'No valid order ids provided' });
    }

    if (req.user?.role === 'coordinator') {
      const placeholders = numericIds.map(() => '?').join(', ');
      const belongsCount = await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM registrations r
         WHERE r.id IN (${placeholders}) AND (r.created_by = ? OR r.email IN (SELECT email FROM users WHERE created_by = ?))`,
        [...numericIds, req.user.id, req.user.id]
      );
      if (!belongsCount || belongsCount.count !== numericIds.length) {
        return res.status(403).json({ error: 'Access denied: one or more registrations do not belong to you' });
      }
    }

    const placeholders = numericIds.map(() => '?').join(', ');
    await pool.execute(
      `UPDATE registrations SET status = ? WHERE id IN (${placeholders})`,
      [status, ...numericIds]
    );

    if (status === 'confirmed') {
      for (const id of numericIds) {
        await maybeFulfillIndividualRegistration(id, status);
      }
    }

    res.json({ message: `${numericIds.length} order(s) updated`, updated: numericIds.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Bulk update failed' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (req.user?.role === 'coordinator') {
      const belongs = await queryOne<{ id: number }>(
        `SELECT r.id FROM registrations r
         WHERE r.id = ? AND (r.created_by = ? OR r.email IN (SELECT email FROM users WHERE created_by = ?))`,
        [id, req.user.id, req.user.id]
      );
      if (!belongs) {
        return res.status(403).json({ error: 'Access denied: you did not create this registration' });
      }
    }
    const reg = await queryOne(
      `SELECT r.*, w.title as workshop_title FROM registrations r
       LEFT JOIN workshops w ON w.id = r.workshop_id WHERE r.id = ?`,
      [id]
    );
    if (!reg) return res.status(404).json({ error: 'Not found' });
    res.json(reg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch registration' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (req.user?.role === 'coordinator') {
      const belongs = await queryOne<{ id: number }>(
        `SELECT r.id FROM registrations r
         WHERE r.id = ? AND (r.created_by = ? OR r.email IN (SELECT email FROM users WHERE created_by = ?))`,
        [id, req.user.id, req.user.id]
      );
      if (!belongs) {
        return res.status(403).json({ error: 'Access denied: you did not create this registration' });
      }
    }
    const existing = await queryOne(`SELECT id FROM registrations WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const allowedFields = [
      'full_name',
      'email',
      'phone',
      'company',
      'coordinator_name',
      'company_phone',
      'company_address',
      'company_trn',
      'job_position',
      'person_id',
      'total_seats',
      'total_amount',
      'invoice_number',
      'status',
    ] as const;

    const updates: string[] = [];
    const params: unknown[] = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'status' && !REGISTRATION_STATUSES.has(req.body[field])) {
          return res.status(400).json({ error: 'Invalid status' });
        }
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    await pool.execute(`UPDATE registrations SET ${updates.join(', ')} WHERE id = ?`, params as (string | number | null)[]);

    if (req.body.status === 'confirmed') {
      await maybeFulfillIndividualRegistration(id, 'confirmed');
    }

    res.json({ message: 'Order updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!REGISTRATION_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const id = parseInt(req.params.id, 10);
    if (req.user?.role === 'coordinator') {
      const belongs = await queryOne<{ id: number }>(
        `SELECT r.id FROM registrations r
         WHERE r.id = ? AND (r.created_by = ? OR r.email IN (SELECT email FROM users WHERE created_by = ?))`,
        [id, req.user.id, req.user.id]
      );
      if (!belongs) {
        return res.status(403).json({ error: 'Access denied: you did not create this registration' });
      }
    }
    await pool.execute(`UPDATE registrations SET status = ? WHERE id = ?`, [
      status,
      id,
    ]);
    await maybeFulfillIndividualRegistration(id, status);
    res.json({ message: 'Status updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (req.user?.role === 'coordinator') {
      const belongs = await queryOne<{ id: number }>(
        `SELECT r.id FROM registrations r
         WHERE r.id = ? AND (r.created_by = ? OR r.email IN (SELECT email FROM users WHERE created_by = ?))`,
        [id, req.user.id, req.user.id]
      );
      if (!belongs) {
        return res.status(403).json({ error: 'Access denied: you did not create this registration' });
      }
    }
    await pool.execute(`DELETE FROM registrations WHERE id = ?`, [id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete registration' });
  }
});

export default router;
