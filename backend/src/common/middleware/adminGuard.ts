import type { NextFunction, Request, Response } from 'express';

/**
 * Requires an authenticated **admin**.
 *
 * Must be registered after `authGuard`, which populates `req.user` from the JWT.
 * A player token gets 403 — never 401 — so the client can tell "wrong role"
 * apart from "not signed in".
 */
export function adminGuard(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication is required' },
    });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Administrator role required' },
    });
    return;
  }

  next();
}

export default adminGuard;
