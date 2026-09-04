/**
 * Shared row-mapping helpers for the Pg*Store classes.
 *
 * `pg` parses a Postgres `date` column into a JS `Date` by default (its
 * built-in type parser for OID 1082), not a string. `String(aDate)` calls
 * `Date.prototype.toString()` ("Fri Oct 16 2026 00:00:00 GMT..."), so the
 * once-common `String(r['col']).slice(0, 10)` pattern silently produced
 * "Fri Oct 16" instead of an ISO date the moment a real Postgres connection
 * was involved (M7 production-cutover drill — every store but
 * `PgSnapshotStore` was newly wired to Postgres in this same milestone, so
 * nothing had ever round-tripped one of these columns for real before).
 * `new Date(v)` accepts a `Date` or a string equally, and `pg` parses `date`
 * at UTC midnight, so `.toISOString().slice(0, 10)` is safe either way.
 */
export const toIsoDate = (v: unknown): string => new Date(v as string | Date).toISOString().slice(0, 10);
