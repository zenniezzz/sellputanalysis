/** Minimal fixed-width console table. */

export interface Column<T> {
  header: string;
  get: (row: T) => string;
  align?: 'left' | 'right';
}

export function renderTable<T>(rows: T[], columns: Column<T>[]): string {
  const cells = rows.map((r) => columns.map((c) => c.get(r)));
  const widths = columns.map((c, i) =>
    Math.max(c.header.length, ...cells.map((row) => row[i]!.length)),
  );

  const pad = (s: string, w: number, align: 'left' | 'right' = 'left') =>
    align === 'right' ? s.padStart(w) : s.padEnd(w);

  const headerLine = columns
    .map((c, i) => pad(c.header, widths[i]!, c.align ?? 'left'))
    .join('  ');
  const rule = widths.map((w) => '-'.repeat(w)).join('  ');
  const bodyLines = cells.map((row) =>
    row.map((cell, i) => pad(cell, widths[i]!, columns[i]!.align ?? 'left')).join('  '),
  );

  return [headerLine, rule, ...bodyLines].join('\n');
}

export const fmt = {
  n: (x: number, dp = 2) => (Number.isFinite(x) ? x.toFixed(dp) : '—'),
  pct: (x: number, dp = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(dp)}%` : '—'),
  usd: (x: number, dp = 2) => (Number.isFinite(x) ? `$${x.toFixed(dp)}` : '—'),
  int: (x: number) => (Number.isFinite(x) ? String(Math.round(x)) : '—'),
};
