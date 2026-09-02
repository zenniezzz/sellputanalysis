/**
 * OCC / OSI option symbol handling.
 *
 * Canonical 21-char form: ROOT (≤6, right-padded with spaces) + YYMMDD + C|P +
 * strike×1000 as 8 digits. The CBOE delayed feed emits the compact form
 * (no padding), e.g. "AAPL240920P00185000".
 */

export interface ParsedOption {
  root: string;
  /** YYYY-MM-DD */
  expiration: string;
  right: 'P' | 'C';
  strike: number;
}

// The last 15 chars are always YYMMDD + C|P + strike×1000 (8 digits); everything
// before is the root (space-padded in the canonical 21-char form). Slicing from
// the right handles adjusted roots that carry a trailing digit (e.g. "AAPL1").
const TAIL = /^(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
const ROOT = /^[A-Z][A-Z0-9]{0,5}$/;

export function parseOptionSymbol(sym: string): ParsedOption {
  const s = sym.trim();
  if (s.length < 16) throw new Error(`unparseable option symbol: ${JSON.stringify(sym)}`);

  const root = s.slice(0, -15).trim();
  const m = TAIL.exec(s.slice(-15));
  if (!m || !ROOT.test(root)) {
    throw new Error(`unparseable option symbol: ${JSON.stringify(sym)}`);
  }
  return {
    root,
    expiration: `20${m[1]}-${m[2]}-${m[3]}`,
    right: m[4] === 'P' ? 'P' : 'C',
    strike: Number(m[5]) / 1000,
  };
}

export function toOccSymbol(p: ParsedOption): string {
  const [y, m, d] = p.expiration.split('-') as [string, string, string];
  const strike8 = String(Math.round(p.strike * 1000)).padStart(8, '0');
  return `${p.root.padEnd(6, ' ')}${y.slice(2)}${m}${d}${p.right}${strike8}`;
}
