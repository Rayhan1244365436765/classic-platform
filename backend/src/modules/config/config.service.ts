import { z } from 'zod';

import { AppError } from '../../common/utils/AppError.js';
import { query } from '../../config/db.js';

/**
 * Admin-tunable game configuration (RTP control).
 *
 * One `game_configs` row per game holds the game-specific knob; a small
 * in-memory cache keeps reads off the hot path (no DB hit per spin). Each game
 * service reads through `getGameConfig()` and falls back to its hard-coded
 * constant, so a missing row or a failed load never breaks a spin.
 *
 * RTP is *derived* from the knob (never stored): for slots it is
 * `lineMultiplier / 12`, for the spin wheel it is `Σ(segments) / 20`. This
 * mirrors `slotsRtp()` / `wheelRtp()` and is kept here to avoid an import cycle.
 */

/** Slots: per-line payout (RTP = 3 lines × (6 / 216) × lineMultiplier = lineMultiplier / 12). */
export const SLOTS_GAME_CONFIG = z.object({
  lineMultiplier: z.number().positive(),
});

/** Spin-to-Win roulette: exactly 20 non-negative segment multipliers (RTP = Σ / 20). */
export const ROULETTE_GAME_CONFIG = z.object({
  segments: z.array(z.number().nonnegative()).length(20),
});

const KNOWN_GAMES = ['slots', 'roulette'] as const;

const cache = new Map<string, unknown>();

function schemaFor(slug: string): z.ZodTypeAny | undefined {
  if (slug === 'slots') return SLOTS_GAME_CONFIG;
  if (slug === 'roulette') return ROULETTE_GAME_CONFIG;
  return undefined;
}

export type GameConfigSummary = {
  id: string;
  config: unknown;
  rtp: number;
  houseEdge: number;
};

/** RTP derived from a validated config object. */
export function derivedRtp(slug: string, config: unknown): number {
  if (slug === 'slots') {
    const parsed = SLOTS_GAME_CONFIG.parse(config);
    return parsed.lineMultiplier / 12;
  }

  if (slug === 'roulette') {
    const parsed = ROULETTE_GAME_CONFIG.parse(config);
    const total = parsed.segments.reduce((sum, value) => sum + value, 0);
    return total / parsed.segments.length;
  }

  throw new AppError('UNKNOWN_GAME', 404, `Unknown game: ${slug}`);
}

/** Loads every `game_configs` row into the in-memory cache. Call once at startup. */
export async function loadGameConfigs(): Promise<void> {
  const result = await query<{ id: string; config: unknown }>(
    'SELECT id, config FROM game_configs',
  );

  cache.clear();
  for (const row of result.rows) {
    cache.set(row.id, row.config);
  }
}

/** Synchronous cache read. Returns undefined when no row has been loaded. */
export function getGameConfig<T>(slug: string): T | undefined {
  return cache.get(slug) as T | undefined;
}

/** Validates + persists a config, then refreshes the in-memory cache. */
export async function setGameConfig(
  slug: string,
  rawConfig: unknown,
  adminId: string,
): Promise<void> {
  const schema = schemaFor(slug);
  if (!schema) {
    throw new AppError('UNKNOWN_GAME', 404, `Unknown game: ${slug}`);
  }

  const config = schema.parse(rawConfig);

  const rtp = derivedRtp(slug, config);
  if (!Number.isFinite(rtp) || rtp <= 0 || rtp > 1) {
    throw new AppError(
      'INVALID_GAME_CONFIG',
      400,
      `This config would yield ${(rtp * 100).toFixed(1)}% RTP — RTP must be greater than 0% and at most 100%`,
    );
  }

  await query(
    `INSERT INTO game_configs (id, config, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (id)
     DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [slug, JSON.stringify(config), adminId],
  );

  cache.set(slug, config);
}

/** Current config + derived RTP for one game, or undefined when not loaded. */
export function getGameConfigSummary(slug: string): GameConfigSummary | undefined {
  const config = getGameConfig(slug);
  if (config === undefined) {
    return undefined;
  }

  const rtp = derivedRtp(slug, config);
  return { id: slug, config, rtp, houseEdge: 1 - rtp };
}

/** Every known game's config + derived RTP/edge. */
export function listGameConfigs(): GameConfigSummary[] {
  return KNOWN_GAMES
    .map((slug) => getGameConfigSummary(slug))
    .filter((entry): entry is GameConfigSummary => entry !== undefined);
}