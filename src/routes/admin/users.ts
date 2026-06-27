import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { insert, pool, query, queryOne } from '../../db/pool.js';
import type { UserRole } from '../../middleware/auth.js';

const PORTAL_ROLES: UserRole[] = ['corporate', 'bank', 'cto', 'cma'];
const ADMIN_CREATABLE_ROLES: UserRole[] = [...PORTAL_ROLES, 'admin', 'elearner', 'individual', 'coordinator'];

function resolveRole(role: unknown): UserRole {
  if (typeof role === 'string' && ADMIN_CREATABLE_ROLES.includes(role as UserRole)) {
    return role as UserRole;
  }
  return 'corporate';
}

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { role } = req.query;
    let sql = `
      SELECT u.id, u.email, u.name, u.company, u.role, u.bank_id, u.is_active, u.must_change_password, u.created_at, u.updated_at, b.name as bank_name
       FROM users u
       LEFT JOIN banks b ON b.id = u.bank_id
       WHERE 1=1
    `;
    const params: unknown[] = [];

    if (req.user?.role === 'coordinator') {
      sql += ` AND u.created_by = ?`;
      params.push(req.user.id);
    }

    if (role) {
      const roles = String(role).split(',').map((r) => r.trim()).filter(Boolean);
      if (roles.length > 0) {
        sql += ` AND u.role IN (${roles.map(() => '?').join(', ')})`;
        params.push(...roles);
      }
    }

    sql += ` ORDER BY u.created_at DESC`;
    const users = await query(sql, params);
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { email, password, name, role, company, bank_id, must_change_password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const userRole = resolveRole(role);
    if (req.user?.role === 'coordinator' && (userRole === 'admin' || userRole === 'coordinator')) {
      return res.status(403).json({ error: 'Coordinators cannot create administrative accounts' });
    }
    const hash = await bcrypt.hash(password, 10);
    const id = await insert(
      `INSERT INTO users (email, password_hash, name, company, bank_id, role, must_change_password, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        email,
        hash,
        name || '',
        userRole === 'bank' || userRole === 'corporate' ? company || null : null,
        userRole === 'bank' ? bank_id || null : null,
        userRole,
        must_change_password !== false ? 1 : 0,
        req.user?.id || null,
      ]
    );
    res.status(201).json({ id });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, role, company, bank_id, is_active, password, must_change_password, managed_by_admin } = req.body;
    const userRole = resolveRole(role);

    if (req.user?.role === 'coordinator') {
      if (userRole === 'admin' || userRole === 'coordinator') {
        return res.status(403).json({ error: 'Coordinators cannot assign administrative roles' });
      }
      const existingUser = await queryOne<{ role: string; created_by: number | null }>(
        `SELECT role, created_by FROM users WHERE id = ?`,
        [id]
      );
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (existingUser.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Access denied: you did not create this user' });
      }
    }

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.execute(
        `UPDATE users SET name=?, company=?, bank_id=?, role=?, is_active=?, must_change_password=?, password_hash=? WHERE id=?`,
        [
          name,
          userRole === 'bank' || userRole === 'corporate' ? company || null : null,
          userRole === 'bank' ? bank_id || null : null,
          userRole,
          is_active ? 1 : 0,
          must_change_password ? 1 : 0,
          hash,
          id,
        ]
      );
    } else {
      await pool.execute(
        `UPDATE users SET name=?, company=?, bank_id=?, role=?, is_active=?, must_change_password=? WHERE id=?`,
        [
          name,
          userRole === 'bank' || userRole === 'corporate' ? company || null : null,
          userRole === 'bank' ? bank_id || null : null,
          userRole,
          is_active ? 1 : 0,
          must_change_password ? 1 : 0,
          id,
        ]
      );
    }
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.user?.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    if (req.user?.role === 'coordinator') {
      const existingUser = await queryOne<{ created_by: number | null }>(
        `SELECT created_by FROM users WHERE id = ?`,
        [id]
      );
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (existingUser.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Access denied: you did not create this user' });
      }
    }
    await pool.execute(`DELETE FROM users WHERE id = ?`, [id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
