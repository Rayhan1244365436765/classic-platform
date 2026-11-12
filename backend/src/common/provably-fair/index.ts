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

/** European roulette pockets: 0–36. */
export const ROULETTE_POCKETS = 37;

/**
 * Deterministically derive a roulette pocket (0–36) from the seed material.
 *
 * HMAC-SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}`) → first 8 hex
 * chars → integer → divide by 0xFFFFFFFF → [0, 1] → × 37 → floor.
 *
 * The divisor is the inclusive maximum, so a digest starting with `ffffffff`
 * produces exactly 1.0 and would floor to 37 (a pocket that does not exist).
 * That 1-in-4-billion case is clamped to 36 — results stay in range without
 * changing the distribution anyone can verify.
 */
export function generateProvablyFairResult(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): number {
  const digest = crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');

  const slice = digest.slice(0, 8);
  const value = Number.parseInt(slice, 16);
  const fraction = value / UINT32_MAX;
  const roll = Math.floor(fraction * ROULETTE_POCKETS);

  return Math.min(roll, ROULETTE_POCKETS - 1);
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
