/**
 * Error reporting + dead-man's-switch heartbeat (plan §10.7, milestone M1.5).
 *
 * All effects are opt-in via env, so this is a no-op in dev / tests:
 *   SENTRY_DSN            → initErrorReporting() wires Sentry (dynamic import)
 *   HEARTBEAT_URL_SNAPSHOT → heartbeat('snapshot') pings it (healthchecks.io style)
 */

export interface ErrorContext {
  [key: string]: unknown;
}

let reporter: ((error: unknown, ctx?: ErrorContext) => void) | null = null;

export async function initErrorReporting(): Promise<void> {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) {
    reporter = (error, ctx) => console.error('[error]', error, ctx ?? '');
    return;
  }
  try {
    const Sentry = (await import('@sentry/node')) as unknown as {
      init(opts: { dsn: string; tracesSampleRate: number }): void;
      captureException(e: unknown, hint?: { extra?: ErrorContext }): void;
    };
    Sentry.init({ dsn, tracesSampleRate: 0 });
    reporter = (error, ctx) => Sentry.captureException(error, ctx ? { extra: ctx } : undefined);
  } catch {
    reporter = (error, ctx) => console.error('[error]', error, ctx ?? '');
  }
}

export function reportError(error: unknown, ctx?: ErrorContext): void {
  (reporter ?? ((e, c) => console.error('[error]', e, c ?? ''))).call(null, error, ctx);
}

export type HeartbeatName = 'snapshot' | 'greek-xcheck' | 'iv-history';

/** Ping the configured URL for `name`. Optional `state` maps to healthchecks.io endpoints. */
export async function heartbeat(
  name: HeartbeatName,
  state: 'success' | 'start' | 'fail' = 'success',
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const base = process.env[`HEARTBEAT_URL_${name.toUpperCase().replace(/-/g, '_')}`];
  if (!base) return false;
  const url = state === 'success' ? base : `${base.replace(/\/$/, '')}/${state}`;
  try {
    const res = await fetchImpl(url, { method: 'POST' });
    return res.ok;
  } catch (e) {
    reportError(e, { heartbeat: name, state });
    return false;
  }
}
