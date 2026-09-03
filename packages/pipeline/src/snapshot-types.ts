/** In-memory snapshot model — mirrors the plan §9 schema. */

export interface CandidateGate {
  dteMin: number;
  dteMax: number;
  deltaLo: number;
  deltaHi: number;
  maxSpreadPct: number;
  minEntryCredit: number;
  minAnnRoc: number;
  maxProbItm: number;
  minOpenInterest: number;
  minVolume: number;
  minUnderlyingPrice: number;
}

export const DEFAULT_GATE: CandidateGate = {
  dteMin: 25,
  dteMax: 45,
  deltaLo: 0.15,
  deltaHi: 0.35,
  maxSpreadPct: 0.08,
  minEntryCredit: 0.3,
  minAnnRoc: 0.12,
  maxProbItm: 0.35,
  minOpenInterest: 500,
  minVolume: 100,
  minUnderlyingPrice: 10,
};

export interface ModelCaution {
  borrow: boolean;
  dividend: boolean;
  ivRankProxy: boolean;
  belowParity: boolean;
  earningsBeforeExpiry: boolean;
  spotAsync: boolean;
}

export interface SnapshotMeta {
  id: string;
  runId: string;
  createdAt: string;
  snapshotDay: string;
  runType: 'scheduled' | 'ondemand' | 'replay';
  status: 'good' | 'degraded' | 'failed';
  dataCompleteness: number;
  scoreBasis: 'cross_sectional' | 'blended' | 'reference';
  metricSchemaVersion: number;
  ratesAsOf: string;
  universeHash: string;
  provider: string;
  displayDelayed: boolean;
  filterDefaults: CandidateGate;
  notes?: string;
}

export interface SnapshotRow {
  occSymbol: string;
  symbol: string;
  expiration: string;
  strike: number;
  multiplier: number;
  dte: number;
  spot: number;
  spotAdj: number;
  bid: number;
  ask: number;
  mid: number;
  last: number | null;
  volume: number;
  openInterest: number;
  quoteAsOf: string;
  entryCredit: number | null;
  entryCredit100: number | null;
  midCredit: number;
  slippageK: number;
  iv: number | null;
  ivVsFitted: number | null;
  ivRank: number | null;
  ivPctile: number | null;
  putSkew25d: number | null;
  delta: number | null;
  gamma: number | null;
  thetaDay: number | null;
  dailyDecay: number | null;
  vega: number | null;
  moneynessPct: number;
  spreadPct: number;
  volOi: number | null;
  decayYield: number | null;
  thetaVega: number | null;
  breakeven: number | null;
  bePct: number | null;
  probItm: number | null;
  pop: number | null;
  emDistance: number | null;
  cspCapital100: number | null;
  regtCapital100: number | null;
  annRoc: number | null;
  capitalBasis: 'csp' | 'regt' | null;
  ev100: number | null;
  maxLoss100: number | null;
  evToMaxloss: number | null;
  creditToMaxloss: number | null;
  sigmaF: number | null;
  vrpHaircut: number | null;
  /** Forecast drift (r − q) used for EV / the P&L cone. */
  mu: number | null;
  score: number | null;
  scoreComponents: Record<string, number> | null;
  modelCaution: ModelCaution;
  assignmentWatch: boolean;
  isCandidate: boolean;
  excludedReason: string | null;
}

export interface IngestionRun {
  runId: string;
  startedAt: string;
  finishedAt: string;
  namesOk: number;
  namesFailed: number;
  contractsPriced: number;
  ivSolveFailures: number;
  candidatesFound: number;
  greekXcheckMedianAbsPct: number | null;
  status: SnapshotMeta['status'];
}

export interface IngestionLogEntry {
  runId: string;
  symbol: string;
  stage: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
  outcome: 'ok' | 'skipped' | 'failed';
  error?: string;
  durationMs: number;
}

export interface Snapshot {
  meta: SnapshotMeta;
  rows: SnapshotRow[];
  run: IngestionRun;
  logs: IngestionLogEntry[];
}

export type IvSampleSource = 'own' | 'orats_backfill' | 'hv_proxy';

export interface IvSample {
  symbol: string;
  /** YYYY-MM-DD */
  date: string;
  atmIv30d: number;
  hv20: number | null;
  hv252: number | null;
  putSkew25d: number | null;
  source: IvSampleSource;
}

/** runSnapshot output: the persisted Snapshot plus the day's history samples. */
export interface RunSnapshotResult extends Snapshot {
  ivSamples: IvSample[];
  /** Candidate metric values by score-metric name, for the reference store. */
  metricSamples: Record<string, number[]>;
}
