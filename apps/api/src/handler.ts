/**
 * Read-only snapshot API (plan §10.4, M1 subset). Framework-free so the
 * walking-skeleton deploy has no build step; the Next.js app supersedes it in M3.
 */

import type { Snapshot, SnapshotRow } from '@pss/pipeline';
import type { SnapshotStore } from '@pss/store';

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const json = (status: number, value: unknown): ApiResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' },
  body: JSON.stringify(value, null, 2),
});

const html = (status: number, body: string): ApiResponse => ({
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body,
});

function candidateView(snap: Snapshot) {
  const candidates = snap.rows.filter((r) => r.isCandidate);
  return {
    meta: snap.meta,
    run: snap.run,
    counts: { rows: snap.rows.length, candidates: candidates.length },
    candidates,
  };
}

export async function handle(method: string, path: string, store: SnapshotStore): Promise<ApiResponse> {
  if (method !== 'GET') return json(405, { error: 'method not allowed' });

  if (path === '/' || path === '/index.html') {
    const snap = await store.latest();
    return html(200, renderPage(snap));
  }
  if (path === '/healthz') return json(200, { ok: true });

  if (path === '/api/snapshots') {
    return json(200, await store.list(50));
  }
  if (path === '/api/snapshots/latest') {
    const snap = await store.latest();
    return snap ? json(200, candidateView(snap)) : json(404, { error: 'no snapshot' });
  }
  const m = /^\/api\/snapshots\/([A-Za-z0-9-]+)$/.exec(path);
  if (m) {
    const key = m[1]!;
    const snap = (await store.getByRunId(key)) ?? (await store.getById(key));
    return snap ? json(200, snap) : json(404, { error: 'not found' });
  }

  return json(404, { error: 'not found' });
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const pct = (x: number | null, dp = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(dp)}%`);
const num = (x: number | null, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(dp));

function renderPage(snap: Snapshot | null): string {
  if (!snap) {
    return `<!doctype html><meta charset=utf8><title>Put-Sell Screener</title>
      <body style="font:14px system-ui;margin:40px"><h1>Put-Sell Screener</h1>
      <p>No snapshot yet. Run <code>npm run cli:run-snapshot -- --limit 12</code>.</p>`;
  }
  const rows = snap.rows.filter((r) => r.isCandidate).slice(0, 60);
  const cell = (v: string) => `<td style="padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums">${v}</td>`;
  const tr = (r: SnapshotRow) =>
    `<tr>
       ${cell(num(r.score, 2))}
       <td style="padding:4px 8px">${esc(r.symbol)}</td>
       <td style="padding:4px 8px">${esc(r.expiration)}</td>
       ${cell(String(r.strike))}${cell(String(r.dte))}${cell(pct(r.moneynessPct))}
       ${cell('$' + num(r.entryCredit))}${cell(pct(r.spreadPct))}${cell(pct(r.iv))}
       ${cell(r.ivRank == null ? '—' : r.ivRank.toFixed(0))}${cell(pct(r.putSkew25d, 1))}${cell(pct(r.ivVsFitted, 2))}
       ${cell(num(r.delta, 3))}${cell(pct(r.decayYield, 2))}${cell(pct(r.pop))}
       ${cell(num(r.evToMaxloss, 3))}${cell(pct(r.annRoc))}
     </tr>`;
  const head = ['score', 'sym', 'exp', 'K', 'DTE', 'mny%', 'credit', 'spr%', 'IV', 'IVR', 'skew', 'resid', 'Δ', 'θ%', 'PoP', 'EV/mL', 'annROC']
    .map((h) => `<th style="padding:4px 8px;text-align:right;border-bottom:1px solid #ccc">${h}</th>`)
    .join('');
  return `<!doctype html><meta charset=utf8><title>Put-Sell Screener — ${esc(snap.meta.runId)}</title>
   <body style="font:13px system-ui;margin:32px;max-width:1100px">
   <h1 style="font-size:18px">Put-Sell Screener</h1>
   <p>${esc(snap.meta.runId)} · status <b>${esc(snap.meta.status)}</b> ·
      completeness ${pct(snap.meta.dataCompleteness)} ·
      ${snap.run.candidatesFound} candidates ·
      score basis <b>${esc(snap.meta.scoreBasis)}</b> ·
      ${snap.meta.displayDelayed ? 'delayed data' : 'realtime'} ·
      <i>${esc(snap.meta.notes ?? '')}</i></p>
   <table style="border-collapse:collapse"><thead><tr>${head}</tr></thead>
   <tbody>${rows.map(tr).join('')}</tbody></table>
   <p style="color:#888">Screening tool, not investment advice. Selling puts carries substantial risk.</p>`;
}
