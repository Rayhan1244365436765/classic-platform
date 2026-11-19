import dotenv from 'dotenv';

// Loads backend/.env when it exists (local development). In containers the values
// arrive as real environment variables, and docker-compose's `env_file` wins.
dotenv.config();

/** `production` in the container, `development` everywhere else. */
export const NODE_ENV: string = process.env.NODE_ENV ?? 'development';
export const isProduction: boolean = NODE_ENV === 'production';

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw.trim() === '') {
    return 3000;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[env] PORT must be an integer between 1 and 65535 (got "${raw}")`);
  }

  return port;
}

export const PORT: number = readPort();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `[env] ${name} must be set when NODE_ENV=production — copy .env.production to .env and fill it in`,
    );
  }

  return value;
}

/**
 * Production refuses the development default and anything short enough to brute
 * force: a known JWT secret would let anyone mint an admin token.
 */
function productionJwtSecret(): string {
  const secret = requireEnv('JWT_SECRET');

  if (secret === 'change-me') {
    throw new Error('[env] JWT_SECRET is still the development default — set a real secret');
  }

  if (secret.length < 32) {
    throw new Error(
      `[env] JWT_SECRET must be at least 32 characters in production (got ${secret.length}); try: openssl rand -hex 32`,
    );
  }

  return secret;
}

/**
 * Database connection string.
 *
 * Development keeps a localhost fallback so `npm run dev` works with no setup; in
 * production there is no fallback — a missing URL would otherwise silently point
 * the API at a database that does not exist.
 */
export const DATABASE_URL: string = isProduction
  ? requireEnv('DATABASE_URL')
  : process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/casino';

export const JWT_SECRET: string = isProduction
  ? productionJwtSecret()
  : process.env.JWT_SECRET ?? 'change-me';

/**
 * Comma-separated list of browser origins allowed to call the API
 * (`https://example.com,https://admin.example.com`).
 *
 * Empty means "no restriction", which is right for development and for production
 * behind the bundled nginx: the browser talks to the same origin, so no CORS
 * pre-flight ever happens.
 */
export const CORS_ORIGIN: string[] = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Opt-in flag for the development-only wallet endpoints
 * (`POST /api/wallet/deposit`, `POST /api/wallet/withdraw`).
 *
 * These credit/debit a wallet directly, bypassing the operator-reviewed
 * `payment/*` flow, so they must never be reachable in production — otherwise a
 * player could mint their own balance. The route gate (see `wallet.routes.ts`)
 * keeps them disabled in production unless this is explicitly set to `true`.
 */
export const ENABLE_DEV_WALLET_ENDPOINTS: boolean =
  process.env.ENABLE_DEV_WALLET_ENDPOINTS === 'true';
