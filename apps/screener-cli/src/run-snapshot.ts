/**
 * M1 pipeline runner (plan §4, §12 milestone M1).
 *
 *   npm run cli:run-snapshot -- --limit 12
 *   npm run cli:run-snapshot -- --names AAPL,MSFT,NVDA,SPY
 *   npm run cli:run-snapshot -- --as-of 2026-09-02-1000-scheduled   # replay a bundle
 *
 * Writes:
 *   .data/snapshots/<day>/<runId>.json        (JsonFileStore)
 *   .data/bundles/<runId>/{manifest,entries}.json   (replay bundle)
 */

import process from 'node:process';
import { join } from 'node:path';
import {
  CboeAdapter,
  RecordingMarketData,
  RecordingRatesSource,
  ReplayMarketData,
  ReplayRatesSource,
  StaticRatesSource,
} from '@pss/market-data';
import {
  DEFAULT_UNIVERSE,
  runSnapshot,
  StaticUniverseSource,
  type UniverseCandidate,
} from '@pss/pipeline';
import { FilePayloadStore } from '@pss/store';
import type { IvHistoryPoint } from '@pss/options';
import { evaluateRunAlerts, heartbeat, initErrorReporting, reportError } from '@pss/observability';
import { fmt } from './table.js';
import { openStores } from './stores.js';

const DATA_ROOT = join(process.cwd(), '.data');
const SNAP_DIR = join(DATA_ROOT, 'snapshots');
const BUNDLE_DIR = join(DATA_ROOT, 'bundles');
const IV_DIR = join(DATA_ROOT, 'iv-history');
const METRIC_FILE = join(DATA_ROOT, 'metric-samples.json');

interface Args {
  limit: number;
  names: string[] | null;
  asOf: string | null;
  runType: 'scheduled' | 'ondemand';
  preset: 'conservative' | 'balanced' | 'aggressive';
}

function parseArgs(argv: string[]): Args {
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    limit: Number(val('--limit') ?? 12),
    names: val('--names')?.split(',').map((s) => s.trim().toUpperCase()) ?? null,
    asOf: val('--as-of') ?? null,
    runType: (val('--run-type') as Args['runType']) ?? 'scheduled',
    preset: (val('--preset') as Args['preset']) ?? 'balanced',
  };
}

function universeFor(args: Args): StaticUniverseSource {
  if (args.names) {
    return new StaticUniverseSource(
      args.names.map(
        (symbol): UniverseCandidate => ({ symbol, sector: 'CLI', isLeveraged: false, isInverse: false, isAdr: false }),
      ),
    );
  }
  return new StaticUniverseSource(DEFAULT_UNIVERSE.slice(0, args.limit));
}

async function main(): Promise<void> {
  await initErrorReporting();
  const args = parseArgs(process.argv.slice(2));
  const { snapshotStore: store, ivStore, metricStore, close } = await openStores({
    snapDir: SNAP_DIR,
    ivDir: IV_DIR,
    metricFile: METRIC_FILE,
  });
  const ivHistory = async (symbol: string): Promise<IvHistoryPoint[]> => ivStore.history(symbol, 400);
  const metricReference = (asOf: string) => metricStore.reference(asOf, 365);

  let snapshot;

  if (args.asOf) {
    const entries = await FilePayloadStore.load(BUNDLE_DIR, args.asOf);
    const manifest = await FilePayloadStore.loadManifest(BUNDLE_DIR, args.asOf);
    console.log(`replaying bundle ${args.asOf} (${manifest.entryCount} payloads, asOf ${manifest.asOf})`);
    snapshot = await runSnapshot({
      universe: universeFor(args),
      marketData: new ReplayMarketData(entries),
      rates: new ReplayRatesSource(entries),
      ivHistory,
      metricReference,
      scorePreset: args.preset,
      now: new Date(`${manifest.asOf}T14:00:00Z`),
      runType: 'replay',
      maxNames: 50,
      concurrency: 8,
    });
  } else {
    const now = new Date();
    const runId = `${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 16).replace(':', '')}-${args.runType}`;
    const bundle = new FilePayloadStore(BUNDLE_DIR, runId, now.toISOString().slice(0, 10));

    snapshot = await runSnapshot({
      universe: universeFor(args),
      marketData: new RecordingMarketData(new CboeAdapter(), bundle),
      rates: new RecordingRatesSource(new StaticRatesSource(), bundle),
      ivHistory,
      metricReference,
      scorePreset: args.preset,
      now,
      runType: args.runType,
      maxNames: 50,
      concurrency: 8,
    });

    const bundleDir = await bundle.flush();
    console.log(`bundle written → ${bundleDir}`);
  }

  const dest = process.env.DATABASE_URL ? 'Postgres (DATABASE_URL)' : null;
  await store.saveSnapshot(snapshot);
  if (snapshot.meta.status !== 'failed') {
    if (snapshot.ivSamples.length > 0) {
      await ivStore.append(snapshot.ivSamples);
      console.log(`iv-history: appended ${snapshot.ivSamples.length} σ30 samples → ${dest ?? IV_DIR}`);
    }
    if (Object.keys(snapshot.metricSamples).length > 0 && snapshot.meta.runType !== 'replay') {
      await metricStore.append(snapshot.meta.snapshotDay, snapshot.metricSamples);
      console.log(`metric-reference: appended ${snapshot.meta.snapshotDay} candidate samples`);
    }
  }

  const { meta, run, rows } = snapshot;
  console.log('');
  console.log(`snapshot ${meta.runId}`);
  console.log(
    `  status=${meta.status}  completeness=${fmt.pct(meta.dataCompleteness)}  ` +
      `namesOk=${run.namesOk}  contractsPriced=${run.contractsPriced}  ` +
      `ivFailures=${run.ivSolveFailures}  candidates=${run.candidatesFound}`,
  );
  console.log(
    `  greek x-check median abs=${run.greekXcheckMedianAbsPct == null ? '—' : `${run.greekXcheckMedianAbsPct.toFixed(2)}%`}  ` +
      `score=${args.preset}/${meta.scoreBasis}  universeHash=${meta.universeHash}`,
  );

  const top = rows.filter((r) => r.isCandidate).slice(0, 15);
  console.log('');
  console.log('  top candidates by composite score:');
  for (const r of top) {
    console.log(
      `    ${r.symbol.padEnd(6)} ${r.expiration} ${String(r.strike).padStart(8)}P  ` +
        `score ${fmt.n(r.score ?? NaN, 2).padStart(6)}  ` +
        `Δ${fmt.n(r.delta ?? NaN, 2).padStart(6)}  IVR ${r.ivRank == null ? ' —' : r.ivRank.toFixed(0).padStart(3)}  ` +
        `skew ${fmt.pct(r.putSkew25d ?? NaN, 1).padStart(6)}  ` +
        `resid ${fmt.pct(r.ivVsFitted ?? NaN, 2).padStart(6)}  ` +
        `θ% ${fmt.pct(r.decayYield ?? NaN, 2).padStart(6)}  ` +
        `annROC ${fmt.pct(r.annRoc ?? NaN).padStart(6)}  ` +
        `EV/mL ${fmt.n(r.evToMaxloss ?? NaN, 3).padStart(7)}`,
    );
  }
  const candidateCount = rows.filter((r) => r.isCandidate).length;
  const proxied = rows.filter((r) => r.isCandidate && r.modelCaution.ivRankProxy).length;
  if (proxied > 0) {
    console.log(`  (${proxied}/${candidateCount} candidates on HV-proxy / absent IV rank — own history still accruing)`);
  }
  console.log('');
  console.log(`  saved → ${dest ?? join(SNAP_DIR, meta.snapshotDay, `${meta.runId}.json`)}`);

  const alerts = evaluateRunAlerts(meta, run);
  for (const a of alerts) {
    console.log(`  ALERT [${a.severity}] ${a.code}: ${a.message}`);
    reportError(new Error(a.message), { cli: 'run-snapshot', alert: a.code, severity: a.severity });
  }

  if (!args.asOf) {
    await heartbeat('snapshot', alerts.length > 0 ? 'fail' : 'success');
  }
  await close();
}

main().catch(async (e) => {
  reportError(e, { cli: 'run-snapshot' });
  await heartbeat('snapshot', 'fail');
  process.exit(1);
});
