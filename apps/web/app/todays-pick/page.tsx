import type { CSSProperties } from 'react';
import Link from 'next/link';
import { applyScreen, DEFAULT_FILTERS } from '@pss/screen';
import type { SnapshotRow } from '@pss/pipeline';
import { scoreOutOf10 } from '@pss/options';
import { getStore } from '../lib/store';
import { screenContext } from '../lib/session';
import { changePct, num, pct, score10, usd } from '../lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: "Today's pick — Put-Sell Screener" };

const N_TICKERS = 3;
const N_CONTRACTS = 15;

/**
 * The "pick zone" for a ticker's contract table: the screen's own DTE and
 * delta bands, plus loose liquidity guards so obviously untradeable quotes
 * (very wide spreads, near-zero interest) don't crowd out real picks. The
 * score-style thresholds (min annROC / IV rank / P(ITM) / credit) are
 * deliberately *not* applied — this list is ranked by composite score, not
 * re-screened.
 */
const PICK_ZONE = {
  dteMin: DEFAULT_FILTERS.dteMin,
  dteMax: DEFAULT_FILTERS.dteMax,
  absDeltaLo: DEFAULT_FILTERS.deltaLo,
  absDeltaHi: DEFAULT_FILTERS.deltaHi,
  maxSpreadPct: 0.25,
  minOpenInterest: 100,
};

function inPickZone(r: SnapshotRow): boolean {
  return (
    r.iv != null &&
    r.score != null &&
    r.delta != null &&
    r.dte >= PICK_ZONE.dteMin &&
    r.dte <= PICK_ZONE.dteMax &&
    Math.abs(r.delta) >= PICK_ZONE.absDeltaLo &&
    Math.abs(r.delta) <= PICK_ZONE.absDeltaHi &&
    r.spreadPct <= PICK_ZONE.maxSpreadPct &&
    r.openInterest >= PICK_ZONE.minOpenInterest
  );
}

/** 0-100 fill width for the score pill's background bar. */
function scorePct(score: number | null): number {
  const v = scoreOutOf10(score);
  return v == null ? 0 : Math.max(0, Math.min(100, (v / 10) * 100));
}

function signCls(x: number | null): string {
  if (x == null) return '';
  return x > 0 ? 'pos' : x < 0 ? 'neg' : '';
}

export default async function TodaysPickPage() {
  const store = await getStore();
  const snap = await store.latest();

  if (!snap) {
    return (
      <article style={{ maxWidth: '70ch', margin: '0 auto', padding: '8px 0 60px', lineHeight: 1.6 }}>
        <p>
          <Link href="/">← Screener</Link>
        </p>
        <h1 style={{ fontSize: 20 }}>Today’s pick</h1>
        <p>No snapshot yet — run the screener pipeline and reload.</p>
      </article>
    );
  }

  const ctx = await screenContext();
  const screened = applyScreen(snap.rows, DEFAULT_FILTERS, ctx).visible;

  // The top N distinct tickers, taken in the screener's own (score-desc) order.
  const tickers: string[] = [];
  for (const r of screened) {
    if (!tickers.includes(r.symbol)) tickers.push(r.symbol);
    if (tickers.length >= N_TICKERS) break;
  }

  // Per ticker: its highest-scoring put contracts inside the pick zone.
  const spotBySym = new Map(snap.rows.map((r) => [r.symbol, r] as const));
  const tables = tickers.map((sym) => {
    const rows = snap.rows
      .filter((r) => r.symbol === sym && inPickZone(r))
      .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
      .slice(0, N_CONTRACTS);
    const ref = rows[0] ?? spotBySym.get(sym);
    return { sym, rows, spot: ref?.spot ?? null, day: ref?.dailyChangePct ?? null };
  });

  return (
    <article style={{ maxWidth: 1000, margin: '0 auto', padding: '8px 0 60px', lineHeight: 1.6 }}>
      <p>
        <Link href="/">← Screener</Link> · <Link href="/method">Method</Link> ·{' '}
        <Link href="/glossary">Glossary</Link>
      </p>
      <h1 style={{ fontSize: 20 }}>Today’s pick</h1>
      <p style={{ color: 'var(--ink-dim)' }}>
        The top {N_TICKERS} tickers on the screener (default filters, ranked by composite score) and up
        to {N_CONTRACTS} of the highest-scoring put contracts on each — DTE {PICK_ZONE.dteMin}–
        {PICK_ZONE.dteMax}, |Δ| {PICK_ZONE.absDeltaLo}–{PICK_ZONE.absDeltaHi}, spread ≤{' '}
        {Math.round(PICK_ZONE.maxSpreadPct * 100)}%, OI ≥ {PICK_ZONE.minOpenInterest}. Snapshot{' '}
        <code>{snap.meta.runId}</code>.
      </p>

      {tables.length === 0 && (
        <div className="empty">No candidates pass the default screen in this snapshot.</div>
      )}

      {tables.map(({ sym, rows, spot, day }) => (
        <div className="panel-card" key={sym}>
          <div className="panel-card-title">
            {sym}
            {spot != null && <> · {usd(spot)}</>}
            {day != null && (
              <>
                {' · '}
                <span className={signCls(day)} style={{ textTransform: 'none', letterSpacing: 0 }}>
                  {changePct(day)} today
                </span>
              </>
            )}
          </div>
          {rows.length === 0 ? (
            <div className="empty">No priced contracts for {sym} in this snapshot.</div>
          ) : (
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>score /10</th>
                    <th>exp</th>
                    <th>strike</th>
                    <th>dte</th>
                    <th>credit</th>
                    <th>spr%</th>
                    <th>iv</th>
                    <th>Δ</th>
                    <th>θ%</th>
                    <th>PoP</th>
                    <th>annROC</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: SnapshotRow) => (
                    <tr key={r.occSymbol}>
                      <td style={{ textAlign: 'left' }}>
                        <span
                          className="score-pill"
                          style={{ '--p': `${scorePct(r.score)}%` } as CSSProperties}
                        >
                          {score10(r.score)}
                        </span>
                      </td>
                      <td className="sym">{r.expiration}</td>
                      <td>{num(r.strike, r.strike % 1 === 0 ? 0 : 2)}P</td>
                      <td>{r.dte}</td>
                      <td>{usd(r.entryCredit)}</td>
                      <td>{pct(r.spreadPct)}</td>
                      <td>{pct(r.iv)}</td>
                      <td className={signCls(r.delta)}>{num(r.delta, 3)}</td>
                      <td>{pct(r.decayYield, 2)}</td>
                      <td>{pct(r.pop)}</td>
                      <td>{pct(r.annRoc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      <p style={{ marginTop: 28, color: 'var(--ink-faint)', fontSize: 11 }}>
        Screening tool, not investment advice. Ranked by composite score inside a loose trade zone — not
        the full screen, so still check the annualized-ROC floor, IV rank, P(ITM), and earnings on the
        screener before acting. Selling puts carries substantial loss potential if the underlying falls
        sharply.
      </p>
    </article>
  );
}
