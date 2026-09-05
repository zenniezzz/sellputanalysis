import Link from 'next/link';
import { DEFAULT_FILTERS } from '@pss/screen';
import { DEFAULT_GATE } from '@pss/pipeline';

export const metadata = { title: 'Model & method — Put-Sell Screener' };

const H = { fontSize: 14, marginTop: 26 } as const;
const TH = {
  textAlign: 'left',
  padding: '6px 12px 6px 0',
  borderBottom: '1px solid var(--border)',
  color: 'var(--ink-faint)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '.06em',
} as const;
const TD = { padding: '6px 12px 6px 0', borderBottom: '1px solid var(--border-soft)' } as const;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

const EARNINGS_LABEL: Record<string, string> = {
  exclude: 'excluded from candidacy',
  flag: 'flagged only (still shown)',
  ignore: 'ignored',
};

export default function MethodPage() {
  return (
    <article style={{ maxWidth: '70ch', margin: '0 auto', padding: '8px 0 60px', lineHeight: 1.65 }}>
      <p>
        <Link href="/">← Screener</Link> · <Link href="/glossary">Glossary</Link>
      </p>
      <h1 style={{ fontSize: 20 }}>Model &amp; method</h1>
      <p>
        This tool screens; it does not recommend. Everything below is an approximation, and none of it
        predicts the future.
      </p>

      <h2 style={{ ...H, marginTop: 0 }}>Composite score</h2>
      <p>A weighted sum of three inputs — this is the whole rule set:</p>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={TH}>Metric</th>
            <th style={TH}>Weight</th>
            <th style={TH}>Direction</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={TD}>Annualized ROC</td>
            <td style={TD}>+1/3</td>
            <td style={TD}>higher is better</td>
          </tr>
          <tr>
            <td style={TD}>IV vs. fitted (residual)</td>
            <td style={TD}>+1/3</td>
            <td style={TD}>higher is better</td>
          </tr>
          <tr>
            <td style={TD}>|Δ| distance from 0.15</td>
            <td style={TD}>−1/3</td>
            <td style={TD}>closer is better</td>
          </tr>
        </tbody>
      </table>

      <h2 style={H}>Default screening rules</h2>
      <p>
        The screen loads with these defaults — every one of them is adjustable live in the sidebar
        without changing what is actually stored in the snapshot:
      </p>
      <ul>
        <li>
          <strong>Underlying price</strong>: ${DEFAULT_FILTERS.minUnderlyingPrice}–$
          {DEFAULT_FILTERS.maxUnderlyingPrice}
        </li>
        <li>
          <strong>Days to expiration</strong>: {DEFAULT_FILTERS.dteMin}–{DEFAULT_FILTERS.dteMax}
        </li>
        <li>
          <strong>|Δ| band</strong>: {DEFAULT_FILTERS.deltaLo}–{DEFAULT_FILTERS.deltaHi}
        </li>
        <li>
          <strong>Max bid/ask spread</strong>: {pct(DEFAULT_FILTERS.maxSpreadPct)} of mid
        </li>
        <li>
          <strong>Min entry credit</strong>: ${DEFAULT_FILTERS.minEntryCredit.toFixed(2)}/share
        </li>
        <li>
          <strong>Min annualized ROC</strong>: {pct(DEFAULT_FILTERS.minAnnRoc)}
        </li>
        <li>
          <strong>Max P(ITM)</strong>: {pct(DEFAULT_FILTERS.maxProbItm)}
        </li>
        <li>
          <strong>Min open interest</strong>: {DEFAULT_FILTERS.minOpenInterest} · <strong>min volume
          (today)</strong>: {DEFAULT_FILTERS.minVolume}
        </li>
        <li>
          <strong>Max order size vs. open interest</strong>: {DEFAULT_FILTERS.maxOrderSizeVsOiPct}%
          (assumes a {DEFAULT_FILTERS.intendedOrderSize}-contract order)
        </li>
        <li>
          <strong>Min IV rank/percentile</strong>: {DEFAULT_FILTERS.minIvRankOrPctile}{' '}
          ({DEFAULT_FILTERS.ivRankMode === 'pctile' ? 'percentile' : 'rank'} basis — see the IV rank
          note below)
        </li>
        <li>
          <strong>Earnings before expiry</strong>:{' '}
          {EARNINGS_LABEL[DEFAULT_FILTERS.earningsBeforeExpiry] ?? DEFAULT_FILTERS.earningsBeforeExpiry}
        </li>
        <li>
          <strong>Expiration type</strong>: {DEFAULT_FILTERS.expirationType}
        </li>
        <li>
          <strong>Capital basis</strong>:{' '}
          {DEFAULT_FILTERS.capitalBasis === 'csp' ? 'cash-secured' : 'Reg-T margin'}
        </li>
      </ul>
      <p>
        These are just what the screen re-filters live from an already-priced snapshot — they can be
        relaxed in either direction. What actually gets <em>fetched and priced</em> in the first place
        is a separate, wider gate upstream, so relaxing a screen filter can only surface a contract the
        ingestion gate already kept: currently DTE {DEFAULT_GATE.dteMin}–{DEFAULT_GATE.dteMax}, |Δ|{' '}
        {DEFAULT_GATE.deltaLo}–{DEFAULT_GATE.deltaHi}, spread ≤ {pct(DEFAULT_GATE.maxSpreadPct)}, open
        interest ≥ {DEFAULT_GATE.minOpenInterest}, volume ≥ {DEFAULT_GATE.minVolume}, and underlying
        price ≥ ${DEFAULT_GATE.minUnderlyingPrice}.
      </p>

      <h2 style={H}>Data</h2>
      <p>
        Quotes are 15-minute-delayed CBOE data. IV rank needs ~1 year of history per name and is
        currently accruing (an ORATS backfill removes the cold start). The snapshot you are looking at
        is timestamped in the header; three scheduled runs a day plus on-demand refresh.
      </p>

      <p style={{ marginTop: 34, color: 'var(--ink-faint)', fontSize: 11 }}>
        Screening tool, not investment advice. Selling puts — cash-secured or on margin — carries
        substantial loss potential if the underlying falls sharply.
      </p>
    </article>
  );
}
