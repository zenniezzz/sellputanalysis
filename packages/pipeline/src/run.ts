/**
 * runSnapshot — the daily pipeline, stages A–H (plan §4).
 *
 * Pure with respect to its injected providers: pass a mock `MarketData` /
 * `RatesSource` / `UniverseSource` in tests, or wrap the real ones in the
 * recording adapters for replay bundles.
 */

import { interpolateZeroRate, type MarketData, type OptionQuote, type RatesSource, type Underlying } from '@pss/market-data';
import { randomUUID } from 'node:crypto';
import { universeHash } from './hash.js';
import { mapPool } from './pool.js';
import { priceContract, type PriceContext } from './price-contract.js';
import {
  DEFAULT_GATE,
  type CandidateGate,
  type IngestionLogEntry,
  type IngestionRun,
  type Snapshot,
  type SnapshotMeta,
  type SnapshotRow,
} from './snapshot-types.js';
import { inStrikeWindow } from './strikes.js';
import { calendarDte } from './time.js';
import { applyUniverseFilters, type UniverseSource } from './universe.js';

export interface RunSnapshotConfig {
  universe: UniverseSource;
  marketData: MarketData;
  rates: RatesSource;
  now?: Date;
  runType?: SnapshotMeta['runType'];
  maxNames?: number;
  universeFetchLimit?: number;
  concurrency?: number;
  gate?: Partial<CandidateGate>;
  provider?: string;
  displayDelayed?: boolean;
  vrpHaircut?: number;
  quoteAgeMs?: number;
  idFactory?: () => string;
}

const METRIC_SCHEMA_VERSION = 1;

interface NameData {
  symbol: string;
  underlying: Underlying;
  quotesByExpiration: Map<string, OptionQuote[]>;
  inWindowPutVolume: number;
}

export async function runSnapshot(config: RunSnapshotConfig): Promise<Snapshot> {
  const now = config.now ?? new Date();
  const startedAt = new Date().toISOString();
  const gate: CandidateGate = { ...DEFAULT_GATE, ...config.gate };
  const maxNames = config.maxNames ?? 50;
  const fetchLimit = config.universeFetchLimit ?? 120;
  const concurrency = config.concurrency ?? 8;
  const vrpHaircut = config.vrpHaircut ?? 0.9;
  const quoteAgeMs = config.quoteAgeMs ?? 0;
  const newId = config.idFactory ?? (() => randomUUID());
  const runType = config.runType ?? 'scheduled';
  const runId = `${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 16).replace(':', '')}-${runType}`;

  const logs: IngestionLogEntry[] = [];
  const log = (e: Omit<IngestionLogEntry, 'runId'>) => logs.push({ runId, ...e });

  // ---- Stage A: rates -------------------------------------------------------
  const aStart = Date.now();
  const curveRes = await config.rates.getCurve(now.toISOString());
  if (!curveRes.ok) {
    log({ symbol: '', stage: 'A', outcome: 'failed', error: JSON.stringify(curveRes.error), durationMs: Date.now() - aStart });
    return failedSnapshot(runId, newId(), now, startedAt, runType, gate, config, logs, 'rates curve unavailable');
  }
  const zeroCurve = curveRes.value;
  log({ symbol: '', stage: 'A', outcome: 'ok', durationMs: Date.now() - aStart });
  const rateAt = (t: number) => interpolateZeroRate(zeroCurve, t);

  // ---- Stage B: universe --------------------------------------------------
  const bStart = Date.now();
  const rawUniverse = await config.universe.list(fetchLimit);
  const universe = applyUniverseFilters(rawUniverse, { excludeLeveragedInverse: true });
  log({ symbol: '', stage: 'B', outcome: 'ok', durationMs: Date.now() - bStart });

  const dteFetchLo = gate.dteMin - 4;
  const dteFetchHi = gate.dteMax + 4;

  // ---- Stage C: chains (pooled) ----------------------------------------------
  const fetched = await mapPool(universe, concurrency, async (cand): Promise<NameData | null> => {
    const cStart = Date.now();
    const uRes = await config.marketData.getUnderlying(cand.symbol);
    if (!uRes.ok) {
      log({ symbol: cand.symbol, stage: 'C', outcome: 'failed', error: JSON.stringify(uRes.error), durationMs: Date.now() - cStart });
      return null;
    }
    const underlying = uRes.value;
    if (underlying.spot < gate.minUnderlyingPrice) {
      log({ symbol: cand.symbol, stage: 'C', outcome: 'skipped', error: `price ${underlying.spot} < ${gate.minUnderlyingPrice}`, durationMs: Date.now() - cStart });
      return null;
    }

    const expRes = await config.marketData.getExpirations(cand.symbol);
    if (!expRes.ok) {
      log({ symbol: cand.symbol, stage: 'C', outcome: 'failed', error: JSON.stringify(expRes.error), durationMs: Date.now() - cStart });
      return null;
    }
    const expirations = expRes.value.filter((e) => {
      const d = calendarDte(now, e);
      return d >= Math.max(2, dteFetchLo) && d <= dteFetchHi;
    });
    if (expirations.length === 0) {
      log({ symbol: cand.symbol, stage: 'C', outcome: 'skipped', error: 'no expiration in DTE window', durationMs: Date.now() - cStart });
      return null;
    }

    const quotesByExpiration = new Map<string, OptionQuote[]>();
    let inWindowPutVolume = 0;
    for (const exp of expirations) {
      const chainRes = await config.marketData.getChain(cand.symbol, exp);
      if (!chainRes.ok) continue;
      const quotes = chainRes.value;
      quotesByExpiration.set(exp, quotes);
      for (const o of quotes) if (o.right === 'P') inWindowPutVolume += o.volume;
    }
    if (quotesByExpiration.size === 0) {
      log({ symbol: cand.symbol, stage: 'C', outcome: 'failed', error: 'all chain fetches failed', durationMs: Date.now() - cStart });
      return null;
    }
    log({ symbol: cand.symbol, stage: 'C', outcome: 'ok', durationMs: Date.now() - cStart });
    return { symbol: cand.symbol, underlying, quotesByExpiration, inWindowPutVolume };
  });

  const okNames = fetched.filter((n): n is NameData => n != null);
  okNames.sort((a, b) => b.inWindowPutVolume - a.inWindowPutVolume);
  const selected = okNames.slice(0, maxNames);
  const target = Math.min(maxNames, universe.length);

  // ---- Stages D–G: price, gate, (score deferred to M2.5) --------------------
  const rows: SnapshotRow[] = [];
  const greekDiffs: number[] = [];
  let contractsPriced = 0;
  let ivSolveFailures = 0;

  for (const name of selected) {
    const dStart = Date.now();
    const earnRes = await config.marketData.getEarnings(name.symbol);
    const earnings = earnRes.ok ? earnRes.value : null;
    const q = 0; // M1: no dividend schedule
    const sAdj = name.underlying.spot;

    for (const [exp, quotes] of name.quotesByExpiration) {
      const dte = calendarDte(now, exp);
      if (dte < 2) continue;
      const t = dte / 365;
      const puts = quotes.filter((o) => o.right === 'P');

      // σ30 proxy (M1): ATM put IV of this expiration, from vendor greeks.
      const atm = puts
        .filter((o) => o.vendorGreeks && o.vendorGreeks.iv > 0)
        .sort((a, b) => Math.abs(a.strike - name.underlying.spot) - Math.abs(b.strike - name.underlying.spot))[0];
      const sigma30 = atm?.vendorGreeks?.iv ?? name.underlying.hv20 ?? 0.3;

      const earningsBeforeExpiry =
        earnings != null && earnings.confirmed &&
        new Date(earnings.next).getTime() <= new Date(`${exp}T20:00:00Z`).getTime() &&
        new Date(earnings.next).getTime() >= now.getTime();

      const ctx: PriceContext = {
        underlying: name.underlying,
        spot: name.underlying.spot,
        spotAdj: sAdj,
        q,
        rate: rateAt(t),
        t,
        dte,
        sigma30,
        gate,
        quoteAgeMs,
        earningsBeforeExpiry,
        vrpHaircut,
      };

      for (const o of puts) {
        if (!inStrikeWindow(o.strike, name.underlying.spot)) continue;
        const res = priceContract(o, ctx);
        rows.push(res.row);
        if (res.ivSolveFailed) ivSolveFailures++;
        else contractsPriced++;
        if (res.greekDiffPct != null) greekDiffs.push(res.greekDiffPct);
      }
    }
    log({ symbol: name.symbol, stage: 'D', outcome: 'ok', durationMs: Date.now() - dStart });
  }

  rows.sort((a, b) => (b.evToMaxloss ?? -Infinity) - (a.evToMaxloss ?? -Infinity));
  const candidatesFound = rows.filter((r) => r.isCandidate).length;

  // ---- Stage H: assemble --------------------------------------------------
  const namesOk = selected.length;
  const namesFailed = universe.length - namesOk;
  const dataCompleteness = target > 0 ? namesOk / target : 0;
  // Plan §4.2: good ≥ 46/50 (0.92); never published < 30/50 (0.60). Scaled to target.
  const status: SnapshotMeta['status'] =
    dataCompleteness < 0.6 ? 'failed' : dataCompleteness < 0.92 ? 'degraded' : 'good';

  const finishedAt = new Date().toISOString();
  const meta: SnapshotMeta = {
    id: newId(),
    runId,
    createdAt: now.toISOString(),
    snapshotDay: now.toISOString().slice(0, 10),
    runType,
    status,
    dataCompleteness,
    scoreBasis: 'cross_sectional',
    metricSchemaVersion: METRIC_SCHEMA_VERSION,
    ratesAsOf: now.toISOString().slice(0, 10),
    universeHash: universeHash(selected.map((n) => n.symbol)),
    provider: config.provider ?? 'cboe-delayed',
    displayDelayed: config.displayDelayed ?? true,
    filterDefaults: gate,
    notes: 'M1: IV rank / composite score not computed; σ30 proxied by ATM IV; q=0.',
  };

  const run: IngestionRun = {
    runId,
    startedAt,
    finishedAt,
    namesOk,
    namesFailed,
    contractsPriced,
    ivSolveFailures,
    candidatesFound,
    greekXcheckMedianAbsPct: greekDiffs.length ? median(greekDiffs) * 100 : null,
    status,
  };

  return { meta, rows, run, logs };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function failedSnapshot(
  runId: string,
  id: string,
  now: Date,
  startedAt: string,
  runType: SnapshotMeta['runType'],
  gate: CandidateGate,
  config: RunSnapshotConfig,
  logs: IngestionLogEntry[],
  notes: string,
): Snapshot {
  const finishedAt = new Date().toISOString();
  return {
    meta: {
      id,
      runId,
      createdAt: now.toISOString(),
      snapshotDay: now.toISOString().slice(0, 10),
      runType,
      status: 'failed',
      dataCompleteness: 0,
      scoreBasis: 'cross_sectional',
      metricSchemaVersion: METRIC_SCHEMA_VERSION,
      ratesAsOf: now.toISOString().slice(0, 10),
      universeHash: universeHash([]),
      provider: config.provider ?? 'cboe-delayed',
      displayDelayed: config.displayDelayed ?? true,
      filterDefaults: gate,
      notes,
    },
    rows: [],
    run: {
      runId,
      startedAt,
      finishedAt,
      namesOk: 0,
      namesFailed: 0,
      contractsPriced: 0,
      ivSolveFailures: 0,
      candidatesFound: 0,
      greekXcheckMedianAbsPct: null,
      status: 'failed',
    },
    logs,
  };
}
