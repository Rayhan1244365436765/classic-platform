import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { DATABASE_URL } from './env.js';

/**
 * Shared PostgreSQL connection pool.
 *
 * Every module queries through `query()` below — nothing creates its own pool,
 * so connection limits stay predictable.
 */
export const pool = new Pool({ connectionString: DATABASE_URL });

// A pool-level error (e.g. Postgres restarting) must never crash the process.
pool.on('error', (error: Error) => {
  console.error('[db] unexpected idle client error:', error.message);
});

/**
 * Thin wrapper around `pool.query` with typed rows.
 *
 * Rows are returned as plain objects; callers are responsible for mapping them.
 */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Runs `work` inside a single database transaction.
 *
 * BEGIN → work → COMMIT on success; any throw triggers exactly one ROLLBACK.
 * The client is always returned to the pool, so a failed request cannot leak a
 * connection. Every money movement in this codebase goes through here.
 */
export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[db] rollback failed:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}


