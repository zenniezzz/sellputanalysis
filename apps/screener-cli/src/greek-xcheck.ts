/**
 * Nightly greek cross-check (plan §5.9, §10.5, milestone M1.5).
 *
 * Fetches live CBOE chains for a handful of names and compares our own-model
 * implied vol against the vendor's for near-the-money contracts. Exits non-zero
 * if the median absolute deviation breaches the SLO — suitable for a scheduled
 * CI job.
 *
 *   npm run cli:greek-xcheck -- --names SPY,AAPL,NVDA --max 0.02
 */

import process from 'node:process';
import { bsmGreeks, impliedVol } from '@pss/options';
import { CboeAdapter, StaticRatesSource, interpolateZeroRate } from '@pss/market-data';
import { heartbeat } from '@pss/observability';

const DEFAULT_NAMES = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA'];

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function dte(expiration: string): number {
  return Math.round((new Date(`${expiration}T20:00:00Z`).getTime() - Date.now()) / 86_400_000);
}

async function main(): Promise<void> {
  const names = (arg('--names')?.split(',') ?? DEFAULT_NAMES).map((s) => s.trim().toUpperCase());
  const maxMedian = Number(arg('--max') ?? 0.02);
  const md = new CboeAdapter();
  const curve = (await new StaticRatesSource().getCurve(new Date().toISOString()));
  const zeroCurve = curve.ok ? curve.value : [];

  const diffs: number[] = [];
  let compared = 0;

  for (const symbol of names) {
    const u = await md.getUnderlying(symbol);
    if (!u.ok) {
      console.error(`  ${symbol}: getUnderlying failed (${u.error.kind})`);
      continue;
    }
    const spot = u.value.spot;
    const exps = await md.getExpirations(symbol);
    if (!exps.ok) continue;
    const target = exps.value
      .map((e) => ({ e, d: dte(e) }))
      .filter((x) => x.d >= 20 && x.d <= 60)
      .sort((a, b) => Math.abs(a.d - 35) - Math.abs(b.d - 35))[0];
    if (!target) continue;

    const chain = await md.getChain(symbol, target.e);
    if (!chain.ok) continue;
    const t = target.d / 365;
    const r = interpolateZeroRate(zeroCurve, t);

    for (const o of chain.value) {
      // Compare where IV is well-identified: OTM-to-slightly-ITM puts (the
      // screener's own operating window), non-trivial premium, real vega.
      if (o.right !== 'P') continue;
      if (!o.vendorGreeks || !(o.vendorGreeks.iv > 0)) continue;
      const ratio = o.strike / spot;
      if (ratio < 0.8 || ratio > 1.03) continue;
      const mid = (o.bid + o.ask) / 2;
      if (o.bid <= 0 || mid < 0.15) continue;

      const iv = impliedVol(mid, { s: spot, k: o.strike, r, q: 0, t }, 'put');
      if (!iv.ok) continue;
      const g = bsmGreeks({ s: spot, k: o.strike, r, q: 0, sigma: iv.iv, t }, 'put');
      if (g.vega < 0.03) continue;

      diffs.push(Math.abs(iv.iv - o.vendorGreeks.iv) / o.vendorGreeks.iv);
      compared++;
      if (Math.abs(g.delta - o.vendorGreeks.delta) > 0.03) {
        console.error(
          `  ${symbol} ${o.occSymbol.trim()}: delta ${g.delta.toFixed(3)} vs vendor ${o.vendorGreeks.delta.toFixed(3)}`,
        );
      }
    }
    console.log(`  ${symbol}: ${target.e} (${target.d} DTE)`);
  }

  if (compared === 0) {
    console.error('no contracts compared — provider unreachable?');
    process.exit(2);
  }

  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)]!;
  const p90 = diffs[Math.floor(diffs.length * 0.9)]!;
  console.log('');
  console.log(`compared ${compared} contracts · median abs IV deviation ${(median * 100).toFixed(2)}% · p90 ${(p90 * 100).toFixed(2)}%`);

  if (median > maxMedian) {
    console.error(`FAIL: median ${(median * 100).toFixed(2)}% exceeds SLO ${(maxMedian * 100).toFixed(2)}%`);
    await heartbeat('greek-xcheck', 'fail');
    process.exit(1);
  }
  console.log('OK');
  await heartbeat('greek-xcheck', 'success');
}

main().catch(async (e) => {
  console.error(e);
  await heartbeat('greek-xcheck', 'fail');
  process.exit(2);
});
