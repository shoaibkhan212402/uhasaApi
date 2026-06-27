import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool, queryOne } from '../../db/pool.js';
import { authRequired, elearnerRequired, signToken, type UserRole } from '../../middleware/auth.js';

const router = Router();

type DbUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  company: string | null;
  must_change_password: number;
  is_uasa_member: number;
};

async function fetchUserProfile(userId: number): Promise<DbUser | null> {
  return queryOne<DbUser>(
    `SELECT id, email, name, role, company, must_change_password, is_uasa_member FROM users WHERE id = ?`,
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
    must_change_password: user.must_change_password === 1,
    is_uasa_member: user.is_uasa_member === 1,
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
  });
}

router.get('/me', authRequired, elearnerRequired, async (req, res) => {
  try {
    const user = await fetchUserProfile(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(toProfileResponse(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.patch('/profile', authRequired, elearnerRequired, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    await pool.execute(`UPDATE users SET name = ? WHERE id = ?`, [name.trim(), req.user!.id]);

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

router.post('/change-password', authRequired, elearnerRequired, async (req, res) => {
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

    res.json({
      message: 'Password updated',
      token: signProfileToken({ ...updated, must_change_password: 0 }),
      user: { ...toProfileResponse(updated), must_change_password: false },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

export default router;
