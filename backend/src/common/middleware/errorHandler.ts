import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AppError } from '../utils/AppError.js';

/**
 * Global error handler — must be registered last, after all routes.
 *
 * Every response uses the same envelope so all three clients parse errors
 * identically:
 *
 *   { "error": { "code": "SOME_CODE", "message": "Human readable text" } }
 *
 *  - ZodError  -> 400 VALIDATION_ERROR (with the failing fields)
 *  - AppError  -> its own status/code (401, 409, ...)
 *  - anything  -> 500 INTERNAL_ERROR (details logged, never leaked)
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    const message = error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'body';
        return `${field}: ${issue.message}`;
      })
      .join('; ');

    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  console.error('[error] unhandled:', error);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
}

export default errorHandler;
