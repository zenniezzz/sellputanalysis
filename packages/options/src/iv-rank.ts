/**
 * IV rank & IV percentile (plan §5.5) with the cold-start proxy (§11).
 *
 * - ≥ `minOwnDays` of 30-day ATM IV history → real IV rank / percentile.
 * - Otherwise, if enough HV20 history exists → the **HV-percentile proxy**
 *   (`basis: 'hv_proxy'`), which the UI labels as approximate.
 * - Otherwise both are null (`basis: 'insufficient'`).
 */

export interface IvHistoryPoint {
  date: string;
  atmIv30d: number;
  hv20: number | null;
}

export interface IvRankResult {
  /** 0–100, position of today's value in its trailing range. */
  ivRank: number | null;
  /** 0–100, share of trailing days strictly below today. */
  ivPctile: number | null;
  basis: 'own' | 'hv_proxy' | 'insufficient';
  nDays: number;
}

export interface IvRankOptions {
  window?: number; // trailing sessions to consider (default 252)
  minOwnDays?: number; // default 60
  minProxyDays?: number; // default 40
}

function rankIn(series: number[], value: number): { rank: number; pctile: number } {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const rank = max > min ? ((value - min) / (max - min)) * 100 : 50;
  const below = series.filter((v) => v < value).length;
  return {
    rank: Math.max(0, Math.min(100, rank)),
    pctile: (below / series.length) * 100,
  };
}

export function ivRankFromHistory(
  current: { atmIv30d: number; hv20: number | null },
  history: IvHistoryPoint[],
  opts: IvRankOptions = {},
): IvRankResult {
  const window = opts.window ?? 252;
  const minOwn = opts.minOwnDays ?? 60;
  const minProxy = opts.minProxyDays ?? 40;

  const recent = history.slice(-window);
  const ivSeries = recent.map((h) => h.atmIv30d).filter((v) => Number.isFinite(v) && v > 0);

  if (ivSeries.length >= minOwn) {
    const { rank, pctile } = rankIn([...ivSeries, current.atmIv30d], current.atmIv30d);
    return { ivRank: rank, ivPctile: pctile, basis: 'own', nDays: ivSeries.length };
  }

  const hvSeries = recent
    .map((h) => h.hv20)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (current.hv20 != null && hvSeries.length >= minProxy) {
    const { rank, pctile } = rankIn([...hvSeries, current.hv20], current.hv20);
    return { ivRank: rank, ivPctile: pctile, basis: 'hv_proxy', nDays: hvSeries.length };
  }

  return { ivRank: null, ivPctile: null, basis: 'insufficient', nDays: ivSeries.length };
}
