/**
 * Minimal trading-calendar helpers (plan §2.1). M1 scope: calendar days to the
 * ~16:00 ET expiration instant. DST-exact and holiday-aware handling is a
 * hardening item (plan §11 "DST / expiration-boundary bugs").
 */

/** UTC offset for New York on a given date: −4 (EDT, Mar–Nov) or −5 (EST). */
function nyOffsetHours(year: number, month1: number, day: number): number {
  // DST: 2nd Sunday of March 07:00 UTC → 1st Sunday of November 06:00 UTC.
  const secondSundayMarch = nthSunday(year, 3, 2);
  const firstSundayNov = nthSunday(year, 11, 1);
  const d = Date.UTC(year, month1 - 1, day);
  return d >= Date.UTC(year, 2, secondSundayMarch) && d < Date.UTC(year, 10, firstSundayNov) ? -4 : -5;
}

function nthSunday(year: number, month1: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  const firstSunday = ((7 - firstDow) % 7) + 1;
  return firstSunday + (n - 1) * 7;
}

/** Milliseconds since epoch of ~16:00 ET on an expiration date `YYYY-MM-DD`. */
export function expirationInstantMs(expirationDate: string): number {
  const [y, m, d] = expirationDate.split('-').map(Number) as [number, number, number];
  const offset = nyOffsetHours(y, m, d);
  return Date.UTC(y, m - 1, d, 16 - offset, 0, 0);
}

/** Calendar days from `now` to the expiration instant (rounded). */
export function calendarDte(now: Date, expirationDate: string): number {
  return Math.round((expirationInstantMs(expirationDate) - now.getTime()) / 86_400_000);
}
