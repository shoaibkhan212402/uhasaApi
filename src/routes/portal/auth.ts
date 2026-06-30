import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool, queryOne } from '../../db/pool.js';
import { authRequired, signToken, type UserRole } from '../../middleware/auth.js';

const router = Router();

type DbUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  company: string | null;
  bank_id: number | null;
  phone: string | null;
  company_address: string | null;
  company_trn: string | null;
  must_change_password: number;
  bank_name?: string | null;
};

async function fetchUserProfile(userId: number): Promise<DbUser | null> {
  return queryOne<DbUser>(
    `SELECT u.id, u.email, u.name, u.role, u.company, u.bank_id, u.phone, u.company_address, u.company_trn, u.must_change_password, b.name AS bank_name
     FROM users u
     LEFT JOIN banks b ON b.id = u.bank_id
     WHERE u.id = ?`,
    [userId]
  );
}

function toProfileResponse(user: DbUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    company: user.company,
    bank_id: user.bank_id,
    phone: user.phone ?? null,
    company_address: user.company_address ?? null,
    company_trn: user.company_trn ?? null,
    bank_name: user.bank_name ?? null,
    must_change_password: user.must_change_password === 1,
  };
}

function signProfileToken(user: DbUser) {
  return signToken({
    id: user.id,
    email: user.email,
    role: user.role as UserRole,
    name: user.name,
    must_change_password: user.must_change_password === 1,
    company: user.company,
    bank_id: user.bank_id,
    phone: user.phone,
    company_address: user.company_address,
    company_trn: user.company_trn,
  });
}

router.get('/me', authRequired, async (req, res) => {
  try {
    const user = await fetchUserProfile(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(toProfileResponse(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.get('/banks', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, name FROM banks WHERE is_active = 1 ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch banks' });
  }
});

router.patch('/profile', authRequired, async (req, res) => {
  try {
    const { name, email, company, bank_id, phone, company_address, company_trn } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const role = req.user!.role;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const cleanPhone = typeof phone === 'string' ? phone.trim() : null;
    const cleanAddress = typeof company_address === 'string' ? company_address.trim() : null;
    const cleanTrn = typeof company_trn === 'string' ? company_trn.trim() : null;

    // Verify email uniqueness
    const existing = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [trimmedEmail, req.user!.id]
    );
    if (existing) {
      return res.status(400).json({ error: 'Email is already in use by another account' });
    }

    if (role === 'corporate') {
      const trimmedCompany = typeof company === 'string' ? company.trim() : '';
      if (!trimmedCompany) {
        return res.status(400).json({ error: 'Company name is required' });
      }
      await pool.execute(`UPDATE users SET name = ?, email = ?, company = ?, phone = ?, company_address = ?, company_trn = ? WHERE id = ?`, [
        trimmedName,
        trimmedEmail,
        trimmedCompany,
        cleanPhone,
        cleanAddress,
        cleanTrn,
        req.user!.id,
      ]);
    } else if (role === 'bank') {
      const bankId = parseInt(String(bank_id), 10);
      if (Number.isNaN(bankId) || bankId <= 0) {
        return res.status(400).json({ error: 'Valid Bank selection is required' });
      }
      await pool.execute(`UPDATE users SET name = ?, email = ?, bank_id = ?, phone = ?, company_address = ?, company_trn = ? WHERE id = ?`, [
        trimmedName,
        trimmedEmail,
        bankId,
        cleanPhone,
        cleanAddress,
        cleanTrn,
        req.user!.id,
      ]);
    } else {
      await pool.execute(`UPDATE users SET name = ?, email = ?, phone = ?, company_address = ?, company_trn = ? WHERE id = ?`, [
        trimmedName,
        trimmedEmail,
        cleanPhone,
        cleanAddress,
        cleanTrn,
        req.user!.id,
      ]);
    }

    const updated = await fetchUserProfile(req.user!.id);
    if (!updated) return res.status(404).json({ error: 'User not found' });

    res.json({
      message: 'Profile updated',
      token: signProfileToken(updated),
      user: toProfileResponse(updated),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.post('/change-password', authRequired, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'Valid current and new password (min 6 chars) required' });
    }

    const user = await queryOne<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = ?`,
      [req.user!.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 10);
    await pool.execute(
      `UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
      [hash, req.user!.id]
    );

    const updated = await fetchUserProfile(req.user!.id);
    if (!updated) return res.status(404).json({ error: 'User not found' });

    const token = signToken({
      id: updated.id,
      email: updated.email,
      role: updated.role as UserRole,
      name: updated.name,
      must_change_password: false,
      company: updated.company,
      bank_id: updated.bank_id,
    });

    res.json({
      message: 'Password updated',
      token,
      user: { ...toProfileResponse(updated), must_change_password: false },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

export default router;
