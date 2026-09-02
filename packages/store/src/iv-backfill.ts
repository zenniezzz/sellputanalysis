/**
 * IV-history backfill importers (plan §3.2, §11, milestone M2).
 *
 * The screener needs ~1 year of 30-day ATM IV per underlying for a real IV rank.
 * Self-accumulation (from `runSnapshot`) covers it after ~60 sessions; a one-time
 * ORATS purchase removes the cold start. This module maps a provider export into
 * `IvSample[]` for `IvHistoryStore.append`.
 */

import type { IvSample } from '@pss/pipeline';

function splitCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
}

const num = (v: string | undefined): number | null => {
  if (v == null || v === '' || v === 'null') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Normalize a date cell (`YYYY-MM-DD`, `MM/DD/YYYY`, or `YYYYMMDD`) to `YYYY-MM-DD`. */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) return `${slash[3]}-${slash[1]!.padStart(2, '0')}-${slash[2]!.padStart(2, '0')}`;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return null;
}

/**
 * ORATS "Core Data — historical" style export. Recognized column aliases
 * (case-insensitive): ticker, trade_date/tradeDate/date, iv30d/atmIvM1/iv_30,
 * orHv20d/hv20, orHv1yr/hv252/hv1yr, slope/skew/putSkew.
 */
export function parseOratsIvHistoryCsv(text: string): IvSample[] {
  const rows = splitCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.toLowerCase());

  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };

  const iTicker = col('ticker', 'symbol');
  const iDate = col('trade_date', 'tradedate', 'date');
  const iIv = col('iv30d', 'atmivm1', 'iv_30', 'iv30');
  const iHv20 = col('orhv20d', 'hv20', 'hv20d');
  const iHv252 = col('orhv1yr', 'hv252', 'hv1yr', 'hv252d');
  const iSkew = col('slope', 'skew', 'putskew', 'put_skew_25d');

  if (iTicker < 0 || iDate < 0 || iIv < 0) {
    throw new Error(`unrecognized IV-history CSV header: ${header.join(',')}`);
  }

  const out: IvSample[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const date = normalizeDate(row[iDate] ?? '');
    const atmIv30d = num(row[iIv]);
    const symbol = (row[iTicker] ?? '').toUpperCase();
    if (!date || atmIv30d == null || atmIv30d <= 0 || !symbol) continue;
    out.push({
      symbol,
      date,
      atmIv30d,
      hv20: iHv20 >= 0 ? num(row[iHv20]) : null,
      hv252: iHv252 >= 0 ? num(row[iHv252]) : null,
      putSkew25d: iSkew >= 0 ? num(row[iSkew]) : null,
      source: 'orats_backfill',
    });
  }
  return out;
}
