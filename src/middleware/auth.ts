import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export type UserRole = 'admin' | 'corporate' | 'bank' | 'cto' | 'cma' | 'individual' | 'elearner' | 'coordinator';

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  name: string;
  must_change_password?: boolean;
  company?: string | null;
  bank_id?: number | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function extractUser(req: Request, res: Response): AuthUser | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  try {
    const token = header.slice(7);
    return jwt.verify(token, config.jwtSecret) as AuthUser;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const user = extractUser(req, res);
  if (!user) return;
  req.user = user;
  next();
}

export function adminRequired(req: Request, res: Response, next: NextFunction) {
  const user = extractUser(req, res);
  if (!user) return;
  if (user.role !== 'admin' && user.role !== 'coordinator') {
    return res.status(403).json({ error: 'Access denied' });
  }
  req.user = user;
  next();
}

const PORTAL_ROLES: UserRole[] = ['corporate', 'bank', 'cto', 'cma'];

export function portalRequired(req: Request, res: Response, next: NextFunction) {
  const user = extractUser(req, res);
  if (!user) return;
  if (!PORTAL_ROLES.includes(user.role)) {
    return res.status(403).json({ error: 'Portal access required' });
  }
  req.user = user;
  next();
}

export function individualRequired(req: Request, res: Response, next: NextFunction) {
  const user = extractUser(req, res);
  if (!user) return;
  if (user.role !== 'individual') {
    return res.status(403).json({ error: 'Individual portal access required' });
  }
  req.user = user;
  next();
}

export function elearnerRequired(req: Request, res: Response, next: NextFunction) {
  const user = extractUser(req, res);
  if (!user) return;
  if (user.role !== 'elearner') {
    return res.status(403).json({ error: 'E-Learning portal access required' });
  }
  req.user = user;
  next();
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      must_change_password: user.must_change_password || false,
      company: user.company || null,
      bank_id: user.bank_id || null,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
  );
}
