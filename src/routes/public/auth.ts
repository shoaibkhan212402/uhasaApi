import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { queryOne } from '../../db/pool.js';
import { signToken, type UserRole } from '../../middleware/auth.js';
import { resolveUasaMember } from '../../services/elearningPricing.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await queryOne<{
      id: number;
      email: string;
      password_hash: string;
      name: string;
      role: UserRole;
      company: string | null;
      bank_id: number | null;
      must_change_password: number;
      is_active: number;
    }>(`SELECT id, email, password_hash, name, role, company, bank_id, must_change_password, is_active FROM users WHERE email = ?`, [email]);

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const profile = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      company: user.company,
      bank_id: user.bank_id,
      must_change_password: user.must_change_password === 1,
    };

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      must_change_password: profile.must_change_password,
      company: user.company,
      bank_id: user.bank_id,
    });

    res.json({ token, user: profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      role,
      company,
      bank_id,
      phone,
      company_address,
      company_trn,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const userRole: UserRole = role === 'bank' ? 'bank' : 'corporate';

    if (userRole === 'bank' && !bank_id) {
      return res.status(400).json({ error: 'Bank selection is required' });
    }

    let resolvedCompany: string | null = company || null;
    let resolvedBankId: number | null = null;

    if (userRole === 'bank') {
      const bank = await queryOne<{ id: number; name: string }>(
        `SELECT id, name FROM banks WHERE id = ? AND is_active = 1`,
        [bank_id]
      );
      if (!bank) {
        return res.status(400).json({ error: 'Selected bank is not available' });
      }
      resolvedCompany = bank.name;
      resolvedBankId = bank.id;
    } else if (!company) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const existing = await queryOne(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { insert } = await import('../../db/pool.js');

    const id = await insert(
      `INSERT INTO users (email, password_hash, name, company, bank_id, role) VALUES (?, ?, ?, ?, ?, ?)`,
      [email, hash, name || '', resolvedCompany, resolvedBankId, userRole]
    );

    if (phone || company_address || company_trn) {
      const details = [
        phone ? `Phone: ${phone}` : null,
        company_address ? `Address: ${company_address}` : null,
        company_trn ? `TRN: ${company_trn}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      if (details) {
        await insert(
          `INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)`,
          [
            name || email,
            email,
            phone || null,
            `${userRole === 'bank' ? 'Bank' : 'Corporate'} registration details`,
            details,
          ]
        );
      }
    }

    const profile = {
      id,
      email,
      role: userRole,
      name: name || '',
      company: resolvedCompany,
      bank_id: resolvedBankId,
      must_change_password: false,
    };

    const token = signToken({ ...profile, role: userRole });
    res.status(201).json({ token, user: profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/register-individual', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const { getOrCreateIndividualUser } = await import('../../services/individualRegistrationService.js');

    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await queryOne<{ id: number; role: string }>(
      `SELECT id, role FROM users WHERE LOWER(email) = ?`,
      [normalizedEmail]
    );
    if (existing) {
      if (existing.role === 'individual') {
        return res.status(409).json({ error: 'An account already exists for this email. Please sign in.' });
      }
      return res.status(409).json({ error: 'This email is registered as a different account type.' });
    }

    const userId = await getOrCreateIndividualUser(normalizedEmail, name || normalizedEmail, password);

    const profile = {
      id: userId,
      email: normalizedEmail,
      role: 'individual' as UserRole,
      name: name || normalizedEmail,
      company: null,
      bank_id: null,
      must_change_password: false,
    };

    const token = signToken({ ...profile, role: 'individual' });
    res.status(201).json({ token, user: profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Account setup failed' });
  }
});

router.post('/register-learner', async (req, res) => {
  try {
    const { email, password, name, is_uasa_member } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await queryOne<{ id: number; role: string }>(
      `SELECT id, role FROM users WHERE LOWER(email) = ?`,
      [normalizedEmail]
    );
    if (existing) {
      if (existing.role === 'elearner') {
        return res.status(409).json({ error: 'An account already exists for this email. Please sign in.' });
      }
      return res.status(409).json({ error: 'This email is registered as a different account type.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { insert } = await import('../../db/pool.js');
    const memberFlag = resolveUasaMember(normalizedEmail, is_uasa_member === true) ? 1 : 0;

    const id = await insert(
      `INSERT INTO users (email, password_hash, name, role, is_uasa_member) VALUES (?, ?, ?, 'elearner', ?)`,
      [normalizedEmail, hash, name || normalizedEmail.split('@')[0], memberFlag]
    );

    const profile = {
      id,
      email: normalizedEmail,
      role: 'elearner' as UserRole,
      name: name || normalizedEmail.split('@')[0],
      company: null,
      bank_id: null,
      must_change_password: false,
      is_uasa_member: memberFlag === 1,
    };

    const token = signToken({ ...profile, role: 'elearner' });
    res.status(201).json({ token, user: profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

export default router;
