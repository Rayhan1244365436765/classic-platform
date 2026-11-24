import { ZodError } from 'zod';

import { AppError } from '../../common/utils/AppError.js';
import { query, withTransaction } from '../../config/db.js';
import { CARD_GAMES } from './games.cards.js';
import { CLUSTER_GAMES } from './games.cluster.js';
import { CORE_GAMES } from './games.core.js';
import {
  cacheGameConfig,
  evictGameConfig,
  getGameConfig,
  loadRawGameConfigs,
} from './config.store.js';
import type { Evaluation, FieldSpec, GameEntry, RtpLine } from './config.types.js';

/**
 * Admin-tunable game configuration (RTP control) for every game.
 *
 * `game_configs` holds one JSONB row per game; `config.store.ts` caches it in
 * memory and each game service reads from the cache, falling back to its built-in
 * constants. This module sits on top: it knows every game's schema, defaults and
 * RTP maths, validates a change, previews its RTP, saves it and writes an audit row.
 *
 * Re-exported so existing imports of `getGameConfig` from here keep working.
 */
export { getGameConfig } from './config.store.js';

const REGISTRY: GameEntry[] = [...CORE_GAMES, ...CARD_GAMES, ...CLUSTER_GAMES];

/** Games the admin can edit, in display order. */
export const KNOWN_GAMES: string[] = REGISTRY.map((game) => game.id);

/** Admin shape of one game: current config, derived RTP, and how to edit it. */
export type GameConfigSummary = {
  id: string;
  label: string;
  description: string;
  /** Current values (the saved row, or the built-in defaults). */
  config: unknown;
  /** True when no row is saved and the built-in defaults are in effect. */
  isDefault: boolean;
  defaults: unknown;
  fields: FieldSpec[];
  lines: RtpLine[];
  /** Highest RTP of the game's bets, or null when it cannot be computed. */
  rtp: number | null;
  houseEdge: number | null;
  note: string | null;
  updatedAt: string | null;
};

function entryFor(slug: string): GameEntry {
  const entry = REGISTRY.find((game) => game.id === slug);
  if (!entry) {
    throw new AppError('UNKNOWN_GAME', 404, `Unknown game: ${slug}`);
  }
  return entry;
}

/** Turns a ZodError into one readable 400. */
function parseOrThrow(entry: GameEntry, raw: unknown): Evaluation {
  try {
    return entry.evaluate(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const message = error.issues
        .map((issue) => `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
        .join('; ');
      throw new AppError('INVALID_GAME_CONFIG', 400, message);
    }
    throw error;
  }
}

/** RTP must be > 0 and ≤ 100%. Games with no computable RTP are exempt. */
function assertSaneRtp(evaluation: Evaluation): void {
  for (const line of evaluation.lines) {
    if (!Number.isFinite(line.rtp) || line.rtp <= 0 || line.rtp > 1) {
      throw new AppError(
        'INVALID_GAME_CONFIG',
        400,
        `This config would give ${line.label} an RTP of ${(line.rtp * 100).toFixed(2)}% — every RTP must be above 0% and at most 100%`,
      );
    }
  }
}

/** Loads every `game_configs` row into the cache. Call once at startup. */
export async function loadGameConfigs(): Promise<void> {
  await loadRawGameConfigs();

  // A row that no longer validates (a schema change, a manual edit) must never
  // reach a game: drop it so the game falls back to its built-in values.
  for (const entry of REGISTRY) {
    const raw = getGameConfig<unknown>(entry.id);
    if (raw === undefined) continue;

    try {
      entry.evaluate(raw);
    } catch {
      console.error(`[config] ignoring invalid saved config for "${entry.id}" — using defaults`);
      evictGameConfig(entry.id);
    }
  }
}

function summarise(entry: GameEntry, updatedAt: string | null): GameConfigSummary {
  const saved = getGameConfig<unknown>(entry.id);
  const evaluation = entry.evaluate(saved ?? entry.defaults());

  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    config: evaluation.config,
    isDefault: saved === undefined,
    defaults: entry.defaults(),
    fields: entry.fields,
    lines: evaluation.lines,
    rtp: evaluation.rtp,
    houseEdge: evaluation.rtp === null ? null : 1 - evaluation.rtp,
    note: evaluation.note,
    updatedAt,
  };
}

async function loadUpdatedAt(): Promise<Map<string, string>> {
  const result = await query<{ id: string; updated_at: Date }>(
    'SELECT id, updated_at FROM game_configs',
  );
  return new Map(result.rows.map((row) => [row.id, new Date(row.updated_at).toISOString()]));
}

/** Every game's config + derived RTP/edge. */
export async function listGameConfigs(): Promise<GameConfigSummary[]> {
  const updated = await loadUpdatedAt();
  return REGISTRY.map((entry) => summarise(entry, updated.get(entry.id) ?? null));
}

/** One game's config + derived RTP/edge. */
export async function getGameConfigSummary(slug: string): Promise<GameConfigSummary> {
  const entry = entryFor(slug);
  const updated = await loadUpdatedAt();
  return summarise(entry, updated.get(slug) ?? null);
}

/** Validates a config and returns its RTP **without saving** (the admin "Calculate RTP"). */
export function previewGameConfig(
  slug: string,
  rawConfig: unknown,
): Pick<GameConfigSummary, 'id' | 'config' | 'lines' | 'rtp' | 'houseEdge' | 'note'> {
  const entry = entryFor(slug);
  const evaluation = parseOrThrow(entry, rawConfig);

  return {
    id: slug,
    config: evaluation.config,
    lines: evaluation.lines,
    rtp: evaluation.rtp,
    houseEdge: evaluation.rtp === null ? null : 1 - evaluation.rtp,
    note: evaluation.note,
  };
}

/** Validates, saves (with an audit row) and applies a config immediately. */
export async function setGameConfig(
  slug: string,
  rawConfig: unknown,
  adminId: string,
): Promise<GameConfigSummary> {
  const entry = entryFor(slug);
  const evaluation = parseOrThrow(entry, rawConfig);
  assertSaneRtp(evaluation);

  const previous = getGameConfig<unknown>(slug) ?? null;
  const json = JSON.stringify(evaluation.config);

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO game_configs (id, config, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (id)
       DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [slug, json, adminId],
    );
    await client.query(
      `INSERT INTO game_config_audit (game_id, previous_config, new_config, rtp, changed_by)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
      [slug, previous === null ? null : JSON.stringify(previous), json, evaluation.rtp, adminId],
    );
  });

  cacheGameConfig(slug, evaluation.config);

  return getGameConfigSummary(slug);
}

/** Drops the saved row so the game goes back to its built-in table (audited). */
export async function resetGameConfig(slug: string, adminId: string): Promise<GameConfigSummary> {
  const entry = entryFor(slug);
  const previous = getGameConfig<unknown>(slug);

  if (previous !== undefined) {
    const defaults = entry.defaults();

    await withTransaction(async (client) => {
      await client.query('DELETE FROM game_configs WHERE id = $1', [slug]);
      await client.query(
        `INSERT INTO game_config_audit (game_id, previous_config, new_config, rtp, changed_by)
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
        [slug, JSON.stringify(previous), JSON.stringify(defaults), entry.evaluate(defaults).rtp, adminId],
      );
    });
    evictGameConfig(slug);
  }

  return getGameConfigSummary(slug);
}

