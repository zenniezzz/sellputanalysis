export const pct = (x: number | null | undefined, dp = 1): string =>
  x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(dp)}%`;

export const num = (x: number | null | undefined, dp = 2): string =>
  x == null || !Number.isFinite(x) ? '—' : x.toFixed(dp);

export const int = (x: number | null | undefined): string =>
  x == null || !Number.isFinite(x) ? '—' : Math.round(x).toLocaleString('en-US');

export const usd = (x: number | null | undefined, dp = 2): string =>
  x == null || !Number.isFinite(x) ? '—' : `$${x.toFixed(dp)}`;

export const usd0 = (x: number | null | undefined): string =>
  x == null || !Number.isFinite(x) ? '—' : `$${Math.round(x).toLocaleString('en-US')}`;

export function searchParamsToUrl(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    params.set(k, Array.isArray(v) ? (v[0] ?? '') : v);
  }
  return params;
}
