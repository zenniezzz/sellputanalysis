import Link from 'next/link';

export const metadata = { title: 'Model & method — Put-Sell Screener' };

const H = { fontSize: 14, marginTop: 26 } as const;

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

      <h2 style={H}>Pricing model</h2>
      <p>
        Every contract is priced with one <strong>Black–Scholes–Merton</strong> model, so the
        comparison across names is fair. Implied volatility is solved from the NBBO mid with Brent’s
        method; greeks are analytic. We cross-check our IV against the data vendor’s nightly and alert
        if the median deviation exceeds 2%.
      </p>
      <p>Where BSM is least trustworthy, and what the flags mean:</p>
      <ul>
        <li>
          <strong>div</strong> — no discrete dividend schedule yet, so q = 0. Overstates the value of
          puts on names with a large dividend before expiry, and understates early-assignment risk.
        </li>
        <li>
          <strong>borrow</strong> — a hard-to-borrow underlying breaks put-call parity; IV solved from
          the mark is inflated and the contract can look richer to sell than it is.
        </li>
        <li>
          <strong>parity</strong> — the quote is below intrinsic (borrow cost or American
          early-exercise value); IV is unidentifiable and the row is excluded from candidacy.
        </li>
        <li>
          <strong>American exercise</strong> — v1 uses European values and shows an
          “assignment watch” flag rather than re-pricing. Cash-settled index options are genuinely
          European and skip this entirely.
        </li>
      </ul>

      <h2 style={H}>Probabilities: two different numbers</h2>
      <p>
        <strong>P(ITM)</strong> is <em>risk-neutral</em> — the model’s N(−d2). It is not the real-world
        frequency with which the put finishes ITM. <strong>PoP</strong> (probability of profit) is
        computed under a <em>forecast</em> distribution and is the one to reason about. The gap
        between them is the variance risk premium.
      </p>

      <h2 style={H}>Expected value and the VRP haircut</h2>
      <p>
        Under the risk-neutral measure, the EV of selling at fair value is ≈ 0 net of costs — useless
        for ranking. The put-selling edge, when it exists, is that implied volatility has historically
        tended to exceed subsequently realized volatility. So EV is computed under a forecast
        lognormal whose volatility is a blend of realized and implied vol, shrunk toward its 1-year
        median and multiplied by a <strong>VRP haircut</strong> (0.90 by default).
      </p>
      <p>
        This means the EV ranking is <strong>only as good as that haircut assumption</strong>. If you
        distrust it, sort by <strong>annualized ROC</strong> or <strong>decay yield</strong> instead —
        both are forecast-free. The haircut will be recalibrated against a realized-performance log
        once one exists.
      </p>

      <h2 style={H}>Composite score</h2>
      <p>
        A weighted sum of z-scores taken against a rolling 1-year reference distribution — so a
        contract’s score does not move when you change an unrelated filter. While that reference is
        still accruing, z-scores fall back to the current snapshot’s robust (median/MAD)
        cross-section; the <strong>score basis</strong> chip in the header says which
        (cross-sectional → blended → reference).
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
