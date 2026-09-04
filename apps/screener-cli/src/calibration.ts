/**
 * Prints the paper-trade calibration report (plan §1.2, §6.5, milestone M6.5).
 *   npm run cli:calibration [-- --user <id>]
 */

import process from 'node:process';
import { join } from 'node:path';
import { calibrationReport } from '@pss/tracker';
import { JsonPaperTradeStore } from '@pss/store';
import { fmt } from './table.js';

async function main(): Promise<void> {
  const i = process.argv.indexOf('--user');
  const userId = i >= 0 ? (process.argv[i + 1] ?? null) : null;

  const store = new JsonPaperTradeStore(join(process.cwd(), '.data', 'paper-trades.json'));
  const report = calibrationReport(await store.list(userId));

  console.log('');
  console.log(`Calibration — ${report.n} closed trades${userId ? ` (user ${userId})` : ' (anonymous)'}`);
  if (report.dateRange) console.log(`  ${report.dateRange.from} → ${report.dateRange.to}`);
  console.log('');

  if (report.n === 0) {
    console.log('  No closed paper trades yet.');
    return;
  }

  if (report.pop) {
    const p = report.pop;
    console.log(
      `  PoP        modeled ${fmt.pct(p.meanModeledPop)}  realized ${fmt.pct(p.realizedWinRate)}  ` +
        `Δ ${p.deltaPp >= 0 ? '+' : ''}${p.deltaPp.toFixed(1)}pp (±${p.ciPp.toFixed(1)})  ` +
        `${p.withinTarget ? 'OK' : 'OUT OF ±5pp'}`,
    );
    for (const b of p.buckets) {
      console.log(
        `    [${b.lo.toFixed(1)}, ${b.hi.toFixed(1)})  n=${String(b.n).padStart(4)}  ` +
          `modeled ${fmt.pct(b.meanModeledPop)}  realized ${fmt.pct(b.realizedWinRate)}  ` +
          `Δ ${b.deltaPp >= 0 ? '+' : ''}${b.deltaPp.toFixed(1)}pp`,
      );
    }
  }
  if (report.credit) {
    console.log(
      `  Credit     median fill bias ${report.credit.medianBiasPct >= 0 ? '+' : ''}` +
        `${report.credit.medianBiasPct.toFixed(1)}% over ${report.credit.n} trades  ` +
        `${report.credit.withinTarget ? 'OK' : 'OUT OF ±15%'}`,
    );
  }
  if (report.ev) {
    console.log(
      `  EV         mean modeled $${report.ev.meanModeled100.toFixed(0)}/contract  ` +
        `realized $${report.ev.meanRealized100.toFixed(0)}` +
        (report.ev.ratio != null ? `  (${report.ev.ratio.toFixed(2)}×)` : ''),
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
