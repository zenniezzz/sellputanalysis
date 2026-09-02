/**
 * Historical daily closes → close-to-close realized volatility.
 * Source: Stooq free daily CSV (Date,Open,High,Low,Close,Volume).
 * M0 stand-in for a proper HV / dividend source (plan §3.1).
 */

import { err, ok, type Result } from './types.js';

export interface HistoricalVol {
  hv20: number | null;
  hv252: number | null;
  asOf: string;
  closes: number[];
}

export function annualizedVol(closes: number[], window: number): number | null {
  if (closes.length < window + 1) return null;
  const slice = closes.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    rets.push(Math.log(slice[i]! / slice[i - 1]!));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

export function parseStooqCsv(text: string): { closes: number[]; asOf: string } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !/^date,/i.test(lines[0]!)) {
    throw new Error('unexpected Stooq CSV');
  }
  const closes: number[] = [];
  let asOf = '';
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',');
    const close = Number(cols[4]);
    if (Number.isFinite(close) && close > 0) {
      closes.push(close);
      asOf = cols[0] ?? asOf;
    }
  }
  return { closes, asOf };
}

export async function fetchHistoricalVol(
  symbol: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<Result<HistoricalVol>> {
  const f = opts.fetchImpl ?? fetch;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`;

  let res: Response;
  try {
    res = await f(url);
  } catch {
    return err({ kind: 'timeout' });
  }
  if (!res.ok) return err({ kind: 'upstream_5xx', status: res.status });

  let parsed: { closes: number[]; asOf: string };
  try {
    parsed = parseStooqCsv(await res.text());
  } catch (e) {
    return err({ kind: 'malformed', detail: String(e) });
  }
  if (parsed.closes.length < 25) {
    return err({ kind: 'malformed', detail: `only ${parsed.closes.length} closes` });
  }

  return ok({
    hv20: annualizedVol(parsed.closes, 20),
    hv252: annualizedVol(parsed.closes, 252),
    asOf: parsed.asOf,
    closes: parsed.closes,
  });
}
