import 'server-only';
import type { PgQueryable } from '@pss/store';

/**
 * One shared Postgres connection pool for every Pg*Store in the app (plan
 * §9/§10 — production cutover, M7). Each store used to open its own pool
 * (or, for several of them, was never wired to Postgres at all — see
 * SECURITY.md/runbook "production cutover" notes); a connection-limited
 * instance (e.g. Neon's free tier) can't afford one pool per store times one
 * per serverless instance. `null` when `DATABASE_URL` isn't set, in which
 * case every store falls back to its JSON-file implementation.
 */
let pool: Promise<PgQueryable | null> | null = null;

export async function getPgPool(): Promise<PgQueryable | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  pool ??= (async () => {
    const pg = (await import('pg')) as unknown as {
      default: { Pool: new (c: { connectionString: string }) => PgQueryable };
    };
    return new pg.default.Pool({ connectionString: url });
  })();
  return pool;
}
