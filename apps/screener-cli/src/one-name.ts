/**
 * M0 one-name pipeline → console (plan §12, milestone M0).
 *
 * Pulls a real CBOE delayed chain for one symbol, prices every put in the strike
 * window with our own BSM, applies the fill/cost model, the forecast-vol EV, and
 * the candidate delta gate, then prints a table sorted by EV / max-loss.
 *
 * Usage:  npm run cli:one-name -- AAPL --dte 35 --delta-lo 0.15 --delta-hi 0.35
 *
 * Caveats (resolved in later milestones): CBOE gives no dividend schedule
 * (q = 0), σ30 is proxied by the chosen expiration's ATM IV (no surface fit),
 * the rate curve is a static snapshot, IV rank / score are not computed.
 */

import process from 'node:process';
import {
  annualizedRoc,
  bePctBelowSpot,
  breakeven,
  bsmGreeks,
  cleanQuoteReject,
  cspCapital100,
  decayYield,
  expectedMoveDistance,
  expectedValue,
  fillModel,
  forecastVol,
  impliedVol,
  moneynessPct,
  normalCdf,
  regTCapital100,
  spreadPct,
} from '@pss/options';
import {
  CboeAdapter,
  fetchHistoricalVol,
  interpolateZeroRate,
  StaticRatesSource,
} from '@pss/market-data';
import { fmt, renderTable, type Column } from './table.js';

interface Args {
  symbol: string;
  targetDte: number;
  deltaLo: number;
  deltaHi: number;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const num = (flag: string, def: number) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) : def;
  };
  return {
    symbol: (positional[0] ?? 'AAPL').toUpperCase(),
    targetDte: num('--dte', 35),
    deltaLo: num('--delta-lo', 0.15),
    deltaHi: num('--delta-hi', 0.35),
  };
}

function calendarDteToExpiry(nowMs: number, expirationDate: string): number {
  // expiration instant ≈ 16:00 ET ≈ 20:00–21:00 UTC; use 20:00 UTC for M0.
  const exp = new Date(`${expirationDate}T20:00:00Z`).getTime();
  return Math.round((exp - nowMs) / 86_400_000);
}

interface Row {
  occ: string;
  strike: number;
  entryCredit: number;
  midCredit: number;
  spreadPct: number;
  ivOwn: number;
  ivVendor: number;
  delta: number;
  gamma: number;
  dailyDecay: number;
  vega: number;
  decayYield: number;
  thetaVega: number;
  probItm: number;
  pop: number;
  emDist: number;
  breakeven: number;
  bePct: number;
  ev100: number;
  maxLoss100: number;
  evToMl: number;
  annRoc: number;
  sigmaF: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const nowMs = Date.now();
  const md = new CboeAdapter();
  const rates = new StaticRatesSource();

  const underlyingRes = await md.getUnderlying(args.symbol);
  if (!underlyingRes.ok) {
    console.error(`getUnderlying(${args.symbol}) failed:`, underlyingRes.error);
    process.exit(1);
  }
  const u = underlyingRes.value;
  const S = u.spot;

  const expRes = await md.getExpirations(args.symbol);
  if (!expRes.ok) {
    console.error('getExpirations failed:', expRes.error);
    process.exit(1);
  }

  const dated = expRes.value
    .map((e) => ({ exp: e, dte: calendarDteToExpiry(nowMs, e) }))
    .filter((x) => x.dte >= 2)
    .sort((a, b) => Math.abs(a.dte - args.targetDte) - Math.abs(b.dte - args.targetDte));
  const chosen = dated[0];
  if (!chosen) {
    console.error('no expiration with DTE >= 2');
    process.exit(1);
  }

  const chainRes = await md.getChain(args.symbol, chosen.exp);
  if (!chainRes.ok) {
    console.error('getChain failed:', chainRes.error);
    process.exit(1);
  }
  const puts = chainRes.value.filter((o) => o.right === 'P');

  const hvRes = await fetchHistoricalVol(args.symbol);
  const hv20 = hvRes.ok ? hvRes.value.hv20 : null;
  const hv252 = hvRes.ok ? hvRes.value.hv252 : null;

  const curveRes = await rates.getCurve(new Date(nowMs).toISOString());
  const T = chosen.dte / 365;
  const r = curveRes.ok ? interpolateZeroRate(curveRes.value, T) : 0.04;
  const q = 0;
  const mu = r - q;
  const sAdj = S;
  const multiplier = 100;
  const isCash = u.settlement === 'cash';

  // σ30 proxy: ATM put IV of the chosen expiration (M0 — no surface fit).
  const atmPut = puts
    .slice()
    .sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S))[0];
  const sigma30 = atmPut?.vendorGreeks?.iv ?? hv20 ?? 0.3;

  const rows: Row[] = [];
  let priced = 0;
  let gated = 0;

  for (const o of puts) {
    if (o.strike < 0.6 * S || o.strike > 1.05 * S) continue;

    const rejected = cleanQuoteReject({
      bid: o.bid,
      ask: o.ask,
      quoteAgeMs: 0, // CBOE delayed feed: treat as fresh for M0
      isNonStandard: o.isNonStandard,
    });
    if (rejected) {
      gated++;
      continue;
    }

    const mid = (o.bid + o.ask) / 2;
    const iv = impliedVol(mid, { s: sAdj, k: o.strike, r, q, t: T }, 'put');
    if (!iv.ok) continue;
    priced++;

    const g = bsmGreeks({ s: sAdj, k: o.strike, r, q, sigma: iv.iv, t: T }, 'put');
    if (Math.abs(g.delta) < args.deltaLo || Math.abs(g.delta) > args.deltaHi) continue;

    const fill = fillModel({ bid: o.bid, ask: o.ask, multiplier });
    const sigmaF = forecastVol({ hv20, hv252, sigma30, vrpHaircut: 0.9 });

    const ev = expectedValue({
      sAdj,
      k: o.strike,
      entryCredit: fill.entryCredit,
      mu,
      sigmaF,
      t: T,
      multiplier,
    });

    const csp = cspCapital100(o.strike, fill.entryCredit, multiplier, u.settlement);
    const regt = regTCapital100({
      s: S,
      k: o.strike,
      entryCredit: fill.entryCredit,
      multiplier,
      isBroadIndex: isCash,
    });
    const capitalBasis100 = isCash ? regt : (csp ?? regt);
    const be = breakeven(o.strike, fill.entryCredit);

    rows.push({
      occ: o.occSymbol.trim(),
      strike: o.strike,
      entryCredit: fill.entryCredit,
      midCredit: fill.midCredit,
      spreadPct: spreadPct(o.bid, o.ask),
      ivOwn: iv.iv,
      ivVendor: o.vendorGreeks?.iv ?? NaN,
      delta: g.delta,
      gamma: g.gamma,
      dailyDecay: g.dailyDecay,
      vega: g.vega,
      decayYield: decayYield(g.dailyDecay, fill.entryCredit),
      thetaVega: g.dailyDecay / g.vega,
      probItm: normalCdf(-g.d2),
      pop: ev.pop,
      emDist: expectedMoveDistance(S, o.strike, sigma30, T),
      breakeven: be,
      bePct: bePctBelowSpot(S, be),
      ev100: ev.ev100,
      maxLoss100: ev.maxLoss100,
      evToMl: ev.evToMaxLoss,
      annRoc: annualizedRoc(fill.entryCredit100, capitalBasis100, chosen.dte),
      sigmaF,
    });
  }

  rows.sort((a, b) => b.evToMl - a.evToMl);

  const columns: Column<Row>[] = [
    { header: 'CONTRACT', get: (x) => x.occ },
    { header: 'STRIKE', align: 'right', get: (x) => fmt.n(x.strike) },
    { header: 'MNY%', align: 'right', get: (x) => fmt.pct(moneynessPct(S, x.strike)) },
    { header: 'CREDIT', align: 'right', get: (x) => fmt.usd(x.entryCredit) },
    { header: 'MID', align: 'right', get: (x) => fmt.usd(x.midCredit) },
    { header: 'SPR%', align: 'right', get: (x) => fmt.pct(x.spreadPct) },
    { header: 'IV', align: 'right', get: (x) => fmt.pct(x.ivOwn) },
    { header: 'IVvend', align: 'right', get: (x) => fmt.pct(x.ivVendor) },
    { header: 'Δ', align: 'right', get: (x) => fmt.n(x.delta, 3) },
    { header: 'θ/day', align: 'right', get: (x) => fmt.n(x.dailyDecay, 4) },
    { header: 'θ%', align: 'right', get: (x) => fmt.pct(x.decayYield, 2) },
    { header: 'θ/vega', align: 'right', get: (x) => fmt.n(x.thetaVega, 3) },
    { header: 'P(ITM)', align: 'right', get: (x) => fmt.pct(x.probItm) },
    { header: 'PoP', align: 'right', get: (x) => fmt.pct(x.pop) },
    { header: 'EMdist', align: 'right', get: (x) => fmt.n(x.emDist, 2) },
    { header: 'BE', align: 'right', get: (x) => fmt.n(x.breakeven) },
    { header: 'BE%', align: 'right', get: (x) => fmt.pct(x.bePct) },
    { header: 'EV$', align: 'right', get: (x) => fmt.n(x.ev100) },
    { header: 'maxL$', align: 'right', get: (x) => fmt.int(x.maxLoss100) },
    { header: 'EV/mL', align: 'right', get: (x) => fmt.n(x.evToMl, 3) },
    { header: 'annROC', align: 'right', get: (x) => fmt.pct(x.annRoc) },
    { header: 'σf', align: 'right', get: (x) => fmt.pct(x.sigmaF) },
  ];

  console.log('');
  console.log(
    `${u.symbol}  spot ${fmt.usd(S)}  |  ${chosen.exp} (${chosen.dte} DTE)  |  ` +
      `r(T)=${fmt.pct(r)}  q=${fmt.pct(q)}  σ30≈${fmt.pct(sigma30)}  ` +
      `HV20=${hv20 == null ? '—' : fmt.pct(hv20)}  HV252=${hv252 == null ? '—' : fmt.pct(hv252)}`,
  );
  console.log(
    `settlement=${u.settlement}  exercise=${u.exerciseStyle}  ` +
      `puts in window: ${priced} priced, ${gated} quote-gated  |  ` +
      `candidates |Δ|∈[${args.deltaLo}, ${args.deltaHi}]: ${rows.length}`,
  );
  console.log('');

  if (rows.length === 0) {
    console.log('No candidates in the delta band. Try --delta-lo / --delta-hi or --dte.');
    return;
  }
  console.log(renderTable(rows, columns));
  console.log('');
  console.log(
    'Note: M0 — q=0 (no dividend schedule from CBOE), σ30 proxied by ATM IV, ' +
      'static rate curve, IV-rank/score not computed. See put-sell-screener-plan.md §12.',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
