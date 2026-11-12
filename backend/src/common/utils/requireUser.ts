import type { Request } from 'express';

import { AppError } from './AppError';

/**
 * Returns the authenticated user id set by `authGuard`.
 *
 * Handlers never trust a body/query `userId`; this is the single place that
 * narrows the optional `req.user` into a string.
 */
export function requireUserId(req: Request): string {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError('UNAUTHORIZED', 401, 'Authenticated user is missing from the request');
  }
  return userId;
}
