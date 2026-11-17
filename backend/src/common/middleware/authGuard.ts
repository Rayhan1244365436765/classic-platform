import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';

import { JWT_SECRET } from '../../config/env.js';

/** Shape of the token payload issued by `auth.service.loginUser`. */
interface AuthTokenPayload extends JwtPayload {
  id: string;
  role: string;
}

const BEARER_PREFIX = 'Bearer ';

function unauthorized(res: Response, message: string): void {
  res.status(401).json({ error: { code: 'UNAUTHORIZED', message } });
}

/**
 * Authentication guard for protected routes.
 *
 * Expects `Authorization: Bearer <token>`, verifies the JWT with `JWT_SECRET`,
 * and attaches `{ id, role }` to `req.user` for downstream handlers.
 * Any missing, malformed, or expired token yields 401.
 *
 * Usage: `router.get('/me', authGuard, handler)`
 */
export function authGuard(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    unauthorized(res, 'Authorization header with a Bearer token is required');
    return;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    unauthorized(res, 'Bearer token is missing');
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as string | AuthTokenPayload;

    if (typeof decoded === 'string' || !decoded.id || !decoded.role) {
      unauthorized(res, 'Token payload is missing id or role');
      return;
    }

    req.user = { id: decoded.id, role: decoded.role };
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
}

export default authGuard;
