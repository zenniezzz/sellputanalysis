/**
 * runSnapshot — the daily pipeline, stages A–H (plan §4).
 *
 * Pure with respect to its injected providers: pass a mock `MarketData` /
 * `RatesSource` / `UniverseSource` in tests, or wrap the real ones in the
 * recording adapters for replay bundles.
 */

import { interpolateZeroRate, type MarketData, type OptionQuote, type RatesSource, type Underlying } from '@pss/market-data';
import {
  computeScores,
  SCORE_PRESETS,
  type IvHistoryPoint,
  type ReferenceStats,
  type ScoreInputRow,
  type ScoreMetric,
} from '@pss/options';
import { randomUUID } from 'node:crypto';
import { universeHash } from './hash.js';
import { mapPool } from './pool.js';
import { priceContract, type PriceContext } from './price-contract.js';
import {
  DEFAULT_GATE,
  type CandidateGate,
  type IngestionLogEntry,
  type IngestionRun,
  type IvSample,
  type RunSnapshotResult,
  type Snapshot,
  type SnapshotMeta,
  type SnapshotRow,
  type UniverseRow,
} from './snapshot-types.js';
import { inStrikeWindow } from './strikes.js';
import { buildNameSurface, type NameSurface } from './surface-build.js';
import { calendarDte, isMonthlyExpiration } from './time.js';
import type { EarningsInfo } from '@pss/market-data';
import { applyUniverseFilters, type UniverseSource } from './universe.js';

export interface RunSnapshotConfig {
  universe: UniverseSource;
  marketData: MarketData;
  rates: RatesSource;
  /** Accrued 30-day ATM IV history for a symbol (ascending by date). Enables real IV rank. */
  ivHistory?: (symbol: string) => Promise<IvHistoryPoint[]>;
  /** Rolling reference distributions for the composite score's z_ref. */
  metricReference?: (asOf: string) => Promise<ReferenceStats>;
  scorePreset?: 'conservative' | 'balanced' | 'aggressive';
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

export async function runSnapshot(config: RunSnapshotConfig): Promise<RunSnapshotResult> {
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
  const ivSamples: IvSample[] = [];
  const greekDiffs: number[] = [];
  let contractsPriced = 0;
  let ivSolveFailures = 0;

  interface NameRollup {
    name: NameData;
    surface: NameSurface;
    earnings: EarningsInfo | null;
    callVolume: number;
    nearestMonthly: string | null;
  }
  const rollups: NameRollup[] = [];

  for (const name of selected) {
    const dStart = Date.now();
    const earnRes = await config.marketData.getEarnings(name.symbol);
    const earnings = earnRes.ok ? earnRes.value : null;
    const q = 0; // M1: no dividend schedule
    const sAdj = name.underlying.spot;
    const history = config.ivHistory ? await config.ivHistory(name.symbol) : [];

    const expMeta = new Map<string, { quotes: OptionQuote[]; t: number; rate: number; dte: number }>();
    for (const [exp, quotes] of name.quotesByExpiration) {
      const dte = calendarDte(now, exp);
      if (dte < 2) continue;
      const t = dte / 365;
      expMeta.set(exp, { quotes, t, rate: rateAt(t), dte });
    }

    // ---- Stage F: smile fit, σ30, residuals, skew, IV rank ----------------
    const surface = buildNameSurface({
      spot: name.underlying.spot,
      spotAdj: sAdj,
      q,
      hv20: name.underlying.hv20,
      expirations: new Map([...expMeta].map(([e, m]) => [e, { quotes: m.quotes, t: m.t, rate: m.rate }])),
      history,
    });

    // ---- Stages D–E: price & gate the candidate puts ----------------------
    let callVolume = 0;
    for (const [exp, m] of expMeta) {
      const puts = m.quotes.filter((o) => o.right === 'P');
      for (const o of m.quotes) if (o.right === 'C') callVolume += o.volume;
      const expSurface = surface.byExpiration.get(exp);

      const earningsBeforeExpiry =
        earnings != null && earnings.confirmed &&
        new Date(earnings.next).getTime() <= new Date(`${exp}T20:00:00Z`).getTime() &&
        new Date(earnings.next).getTime() >= now.getTime();

      const ctx: PriceContext = {
        underlying: name.underlying,
        spot: name.underlying.spot,
        spotAdj: sAdj,
        q,
        rate: m.rate,
        t: m.t,
        dte: m.dte,
        sigma30: surface.sigma30,
        gate,
        quoteAgeMs,
        earningsBeforeExpiry,
        vrpHaircut,
        ivRank: surface.ivRank,
        ivPctile: surface.ivPctile,
        ivRankIsProxy: surface.ivRankIsProxy,
        putSkew25d: expSurface?.putSkew25d ?? null,
        residualByStrike: expSurface?.residualByStrike ?? new Map(),
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
    ivSamples.push(...maybeIvSample(name.symbol, now, surface, name.underlying));
    const nearestMonthly =
      [...expMeta.keys()].filter(isMonthlyExpiration).sort()[0] ?? null;
    rollups.push({ name, surface, earnings, callVolume, nearestMonthly });
    log({ symbol: name.symbol, stage: 'D', outcome: 'ok', durationMs: Date.now() - dStart });
  }

  // ---- Stage G: composite score ------------------------------------------
  const scoreConfig = SCORE_PRESETS[config.scorePreset ?? 'balanced'];
  const reference = config.metricReference
    ? await config.metricReference(now.toISOString().slice(0, 10))
    : {};
  const scoreInputs: ScoreInputRow[] = rows.map((r) => ({
    priced: r.iv != null,
    isCandidate: r.isCandidate,
    evToMaxloss: r.evToMaxloss,
    annRoc: r.annRoc,
    ivVsFitted: r.ivVsFitted,
    ivRank: r.ivRank,
    spreadPct: r.spreadPct,
    delta: r.delta,
    caution: {
      borrow: r.modelCaution.borrow,
      dividend: r.modelCaution.dividend,
      earningsBeforeExpiry: r.modelCaution.earningsBeforeExpiry,
      ivRankProxy: r.modelCaution.ivRankProxy,
    },
  }));
  const scored = computeScores(scoreInputs, reference, scoreConfig);
  rows.forEach((r, i) => {
    r.score = scored.rows[i]!.score;
    r.scoreComponents = scored.rows[i]!.components;
  });
  const metricSamples = scored.metricSamples as Partial<Record<ScoreMetric, number[]>>;

  rows.sort(
    (a, b) =>
      (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
      (b.evToMaxloss ?? -Infinity) - (a.evToMaxloss ?? -Infinity),
  );
  const candidatesFound = rows.filter((r) => r.isCandidate).length;

  // ---- Universe rollup (plan §8.2) ---------------------------------------
  const universeRows: UniverseRow[] = rollups.map((ru) => {
    const nameRows = rows.filter((r) => r.symbol === ru.name.symbol);
    const u = ru.name.underlying;
    const nextEarnings = ru.earnings?.next?.slice(0, 10) ?? null;
    return {
      symbol: ru.name.symbol,
      sector: u.sector,
      spot: u.spot,
      settlement: u.settlement,
      inWindowPutVolume: ru.name.inWindowPutVolume,
      inWindowCallVolume: ru.callVolume,
      putCallRatio: ru.callVolume > 0 ? ru.name.inWindowPutVolume / ru.callVolume : null,
      sigma30: Number.isFinite(ru.surface.sigma30) ? ru.surface.sigma30 : null,
      ivRank: ru.surface.ivRank,
      ivPctile: ru.surface.ivPctile,
      ivRankProxy: ru.surface.ivRankIsProxy,
      putSkew25d:
        [...ru.surface.byExpiration.values()].map((e) => e.putSkew25d).find((s) => s != null) ?? null,
      hv20: u.hv20,
      borrowRate: u.borrowRate,
      hardToBorrow: u.hardToBorrow,
      nextEarnings,
      earningsConfirmed: ru.earnings?.confirmed ?? false,
      earningsBeforeNearestMonthly:
        nextEarnings != null && ru.nearestMonthly != null && nextEarnings <= ru.nearestMonthly,
      candidateCount: nameRows.filter((r) => r.isCandidate).length,
      pricedPutCount: nameRows.filter((r) => r.iv != null).length,
    };
  });
  universeRows.sort((a, b) => b.inWindowPutVolume - a.inWindowPutVolume);

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
    scoreBasis: scored.basis,
    metricSchemaVersion: METRIC_SCHEMA_VERSION,
    ratesAsOf: now.toISOString().slice(0, 10),
    universeHash: universeHash(selected.map((n) => n.symbol)),
    provider: config.provider ?? 'cboe-delayed',
    displayDelayed: config.displayDelayed ?? true,
    filterDefaults: gate,
    notes: `M2.5: smile-fitted σ30/skew/residual; IV rank from history or HV proxy; composite score (${config.scorePreset ?? 'balanced'}, ${scored.basis}); q=0.`,
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

  return { meta, rows, universe: universeRows, run, logs, ivSamples, metricSamples };
}

/** One 30-day ATM IV sample per name per day for the history store. */
function maybeIvSample(
  symbol: string,
  now: Date,
  surface: NameSurface,
  underlying: Underlying,
): IvSample[] {
  if (!Number.isFinite(surface.sigma30) || surface.sigma30 <= 0) return [];
  const nearest30 = [...surface.byExpiration.values()].sort(
    (a, b) => Math.abs(a.putSkew25d ?? 0) - Math.abs(b.putSkew25d ?? 0),
  )[0];
  return [
    {
      symbol,
      date: now.toISOString().slice(0, 10),
      atmIv30d: surface.sigma30,
      hv20: underlying.hv20,
      hv252: underlying.hv252,
      putSkew25d: nearest30?.putSkew25d ?? null,
      source: 'own',
    },
  ];
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
): RunSnapshotResult {
  const finishedAt = new Date().toISOString();
  return {
    ivSamples: [],
    universe: [],
    metricSamples: {},
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
