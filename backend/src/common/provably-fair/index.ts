import crypto from 'node:crypto';

/**
 * Provably fair RNG (see docs/ARCHITECTURE.md §4).
 *
 * Commit–reveal scheme:
 *   1. the server generates `serverSeed` and publishes `SHA256(serverSeed)`
 *      *before* the bet;
 *   2. the outcome is derived from HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`);
 *   3. after settlement the seed is revealed, so anyone can recompute (1) and (2).
 */

/** Highest value an 8-hex-char slice can hold (0xffffffff). */
const UINT32_MAX = 0xffffffff;

/** Number of distinct 8-hex-char values (2³²) — used to map to `[0, 1)`. */
const UINT32_RANGE = 2 ** 32;

/** European roulette pockets: 0–36. */
export const ROULETTE_POCKETS = 37;

/**
 * Deterministically derive an integer in `[0, slots)` from the seed material.
 *
 * HMAC-SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}`) → first 8 hex
 * chars → integer → divide by 0xFFFFFFFF → [0, 1] → × slots → floor.
 *
 * The divisor is the inclusive maximum, so a digest starting with `ffffffff`
 * produces exactly 1.0 and would floor to `slots` (out of range). That
 * 1-in-4-billion case is clamped to `slots - 1`.
 */
export function generateProvablyFairIndex(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  slots: number,
): number {
  if (!Number.isInteger(slots) || slots < 2) {
    throw new Error('slots must be an integer >= 2');
  }

  const digest = crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');

  const slice = digest.slice(0, 8);
  const value = Number.parseInt(slice, 16);
  const fraction = value / UINT32_MAX;
  const roll = Math.floor(fraction * slots);

  return Math.min(roll, slots - 1);
}

/**
 * Deterministically derive a float in `[0, 1)` from the seed material.
 *
 * Same digest as `generateProvablyFairIndex`: the first 8 hex chars are a
 * uint32, divided by 2³². Used by games that need a continuous random value
 * (e.g. the Aviator crash curve) rather than a discrete index.
 */
export function generateProvablyFairFloat(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): number {
  const digest = crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');

  const value = Number.parseInt(digest.slice(0, 8), 16);

  return value / UINT32_RANGE;
}

/**
 * European roulette pocket (0–36) — kept for the legacy wheel contract.
 */
export function generateProvablyFairResult(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): number {
  return generateProvablyFairIndex(serverSeed, clientSeed, nonce, ROULETTE_POCKETS);
}

/** Random 32-byte seed, hex encoded (64 characters). Never reveal before settlement. */
export function generateServerSeed(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Random client seed (16 bytes, hex). Public input; may later come from the player. */
export function generateClientSeed(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** SHA-256 commitment published before the round: lowercase hex, 64 characters. */
export function hashServerSeed(serverSeed: string): string {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}
