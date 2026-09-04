/**
 * Wires every server-side request error (route handlers, RSC render errors,
 * middleware) into @pss/observability's reporter — plan §10.7's "read-API 5xx
 * > 1%" alert had nothing feeding it before this (M7 production cutover):
 * route handlers threw and Next returned a 500, but nothing captured *why*.
 * `initErrorReporting()` is a no-op console.error without SENTRY_DSN, so this
 * is harmless in dev and gives at least a grep-able stack trace in server
 * logs even pre-Sentry.
 *
 * Both exports are Next.js's own hook names (register() at boot,
 * onRequestError() per failed request) — see
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
import type { Instrumentation } from 'next';
import { initErrorReporting, reportError } from '@pss/observability';

export async function register(): Promise<void> {
  await initErrorReporting();
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  reportError(error, {
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routeType: context.routeType,
  });
};
