import { query } from '../../config/db.js';

/**
 * In-memory cache of the `game_configs` table.
 *
 * Every game service reads its tunable numbers through `getGameConfig()` and falls
 * back to its built-in constants when no row exists, so a missing row or a failed
 * load never breaks a spin and nothing hits the database on the hot path.
 *
 * This module is deliberately free of game imports: the game services import it,
 * and `config.service.ts` (which imports the game services for their RTP maths)
 * sits on top of it — keeping the dependency one-way.
 */

const cache = new Map<string, unknown>();

/** Loads every `game_configs` row into the cache (unvalidated). */
export async function loadRawGameConfigs(): Promise<void> {
  const result = await query<{ id: string; config: unknown }>(
    'SELECT id, config FROM game_configs',
  );

  cache.clear();
  for (const row of result.rows) {
    cache.set(row.id, row.config);
  }
}

/** Synchronous read. `undefined` means "use the built-in default". */
export function getGameConfig<T>(slug: string): T | undefined {
  return cache.get(slug) as T | undefined;
}

export function cacheGameConfig(slug: string, config: unknown): void {
  cache.set(slug, config);
}

export function evictGameConfig(slug: string): void {
  cache.delete(slug);
}

export function cachedGameConfigIds(): string[] {
  return [...cache.keys()];
}
