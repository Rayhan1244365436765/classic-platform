import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';

import { query } from '../../config/db';
import { JWT_SECRET } from '../../config/env';
import { AppError } from '../../common/utils/AppError';
import type { LoginInput, RegisterInput } from './auth.schema';

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN: SignOptions['expiresIn'] = '7d';

/** Postgres error code for `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/** User shape safe to return over HTTP — never includes the password hash. */
export type PublicUser = {
  id: string;
  phone: string;
  role: string;
};

type UserRow = {
  id: string;
  phone: string;
  password_hash: string;
  role: string;
};

export type AuthResult = {
  token: string;
  user: PublicUser;
};

/**
 * Create a player account.
 *
 * The password is hashed with bcrypt (cost 10) and the plaintext is never stored
 * or logged. A duplicate phone number is surfaced by the unique constraint on
 * `users.phone` and translated into a 409.
 */
export async function registerUser(data: RegisterInput): Promise<PublicUser> {
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  try {
    const result = await query<PublicUser>(
      `INSERT INTO users (phone, password_hash)
            VALUES ($1, $2)
         RETURNING id, phone, role`,
      [data.phone, passwordHash],
    );

    const user = result.rows[0];
    if (!user) {
      throw new AppError('USER_NOT_CREATED', 500, 'User could not be created');
    }

    return user;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        'PHONE_ALREADY_EXISTS',
        409,
        'A user with this phone number already exists',
      );
    }
    throw error;
  }
}

/**
 * Verify credentials and issue an access token.
 *
 * Unknown phone and wrong password return the same 401 message so the endpoint
 * cannot be used to enumerate registered numbers.
 */
export async function loginUser(data: LoginInput): Promise<AuthResult> {
  const result = await query<UserRow>(
    `SELECT id, phone, password_hash, role
       FROM users
      WHERE phone = $1
      LIMIT 1`,
    [data.phone],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid phone number or password');
  }

  const passwordMatches = await bcrypt.compare(data.password, row.password_hash);
  if (!passwordMatches) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid phone number or password');
  }

  const user: PublicUser = { id: row.id, phone: row.phone, role: row.role };
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

  return { token, user };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === UNIQUE_VIOLATION;
}
