/**
 * Minimal input-bounds guards for the write endpoints (M6.8 security review,
 * plan §10.8 "input clamped"). Not a schema library — just the checks that
 * stop an unbounded/malformed body from being persisted: symbol shape, string
 * length caps, and finite-number sanity. Reject with a 400 on failure rather
 * than clamp silently — these are user-authored records, not filter params.
 */

const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const MAX_LIST = 200;
const MAX_NAME_LEN = 200;
const MAX_QUERY_LEN = 4000;

export function cleanSymbols(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > MAX_LIST) return null;
  const out: string[] = [];
  for (const s of input) {
    if (typeof s !== 'string') return null;
    const sym = s.trim().toUpperCase();
    if (!SYMBOL_RE.test(sym)) return null;
    out.push(sym);
  }
  return out;
}

export function cleanSymbol(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const sym = input.trim().toUpperCase();
  return SYMBOL_RE.test(sym) ? sym : null;
}

export function cleanName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.trim();
  return name && name.length <= MAX_NAME_LEN ? name : null;
}

/** A URL query string (filters), bounded — not parsed/validated further here. */
export function cleanQueryString(input: unknown): string {
  return typeof input === 'string' && input.length <= MAX_QUERY_LEN ? input : '';
}

export function finiteNumber(input: unknown, { min = -Infinity, max = Infinity } = {}): number | null {
  const n = typeof input === 'number' ? input : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
