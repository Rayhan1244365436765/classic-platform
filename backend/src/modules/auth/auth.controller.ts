import type { NextFunction, Request, Response } from 'express';

import { loginSchema, registerSchema } from './auth.schema.js';
import { loginUser, registerUser } from './auth.service.js';

/**
 * POST /api/auth/register
 * Validates the body, creates the account, returns 201 with the public user.
 */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = registerSchema.parse(req.body);
    const user = await registerUser(data);
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/login
 * Validates the body, verifies credentials, returns 200 with a JWT.
 */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = loginSchema.parse(req.body);
    const { token, user } = await loginUser(data);
    res.status(200).json({ token, user });
  } catch (error) {
    next(error);
  }
}
