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
import { FilePayloadStore, JsonFileStore, JsonIvHistoryStore } from '@pss/store';
import type { IvHistoryPoint } from '@pss/options';
import { heartbeat, initErrorReporting, reportError } from '@pss/observability';
import { fmt } from './table.js';

const DATA_ROOT = join(process.cwd(), '.data');
const SNAP_DIR = join(DATA_ROOT, 'snapshots');
const BUNDLE_DIR = join(DATA_ROOT, 'bundles');
const IV_DIR = join(DATA_ROOT, 'iv-history');

interface Args {
  limit: number;
  names: string[] | null;
  asOf: string | null;
  runType: 'scheduled' | 'ondemand';
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
  const store = new JsonFileStore(SNAP_DIR);
  const ivStore = new JsonIvHistoryStore(IV_DIR);
  const ivHistory = async (symbol: string): Promise<IvHistoryPoint[]> => ivStore.history(symbol, 400);

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
      now,
      runType: args.runType,
      maxNames: 50,
      concurrency: 8,
    });

    const bundleDir = await bundle.flush();
    console.log(`bundle written → ${bundleDir}`);
  }

  await store.saveSnapshot(snapshot);
  if (snapshot.meta.status !== 'failed' && snapshot.ivSamples.length > 0) {
    await ivStore.append(snapshot.ivSamples);
    console.log(`iv-history: appended ${snapshot.ivSamples.length} σ30 samples → ${IV_DIR}`);
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
      `universeHash=${meta.universeHash}`,
  );

  const top = rows.filter((r) => r.isCandidate).slice(0, 15);
  console.log('');
  console.log('  top candidates by EV/max-loss:');
  for (const r of top) {
    console.log(
      `    ${r.symbol.padEnd(6)} ${r.expiration} ${String(r.strike).padStart(8)}P  ` +
        `Δ${fmt.n(r.delta ?? NaN, 2).padStart(6)}  IV ${fmt.pct(r.iv ?? NaN).padStart(6)}  ` +
        `IVR ${r.ivRank == null ? '  —' : r.ivRank.toFixed(0).padStart(3)}  ` +
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
  console.log(`  saved → ${join(SNAP_DIR, meta.snapshotDay, `${meta.runId}.json`)}`);

  if (!args.asOf) {
    await heartbeat('snapshot', meta.status === 'failed' ? 'fail' : 'success');
  }
}

main().catch(async (e) => {
  reportError(e, { cli: 'run-snapshot' });
  await heartbeat('snapshot', 'fail');
  process.exit(1);
});
