/**
 * Postgres snapshot store (plan §9, §10). Exercised in CI against a Postgres
 * service; locally the JsonFileStore is the default. `pg` is a peer/optional
 * dependency — install it where you use this store.
 *
 * `migrate()` inlines its own SQL (matching every other `Pg*Store`) rather
 * than reading `schema.sql` at runtime: a bundler that processes this file
 * (Next.js's webpack build does, via `transpilePackages`) statically
 * intercepts `new URL('./literal', import.meta.url)` for asset handling,
 * which broke `fileURLToPath` here the moment something actually called
 * `migrate()` from inside the built app (M7 production-cutover drill —
 * `TypeError: The "path" argument must be of type string or an instance of
 * URL. Received an instance of URL`). Inline SQL also means the schema ships
 * inside the JS bundle itself, so it survives serverless file-tracing with no
 * extra config. `schema.sql` stays the human-readable, `psql -f`-able
 * reference for a one-shot manual bootstrap; keep the two in sync by hand
 * (there's no build/codegen step in this repo to generate one from the
 * other) — `store.test.ts`'s integration test applies this inline SQL for
 * real, so drift shows up as a test failure, not just a docs mismatch.
 */

import type {
  IngestionLogEntry,
  IngestionRun,
  Snapshot,
  SnapshotMeta,
  SnapshotRow,
} from '@pss/pipeline';
import type { SnapshotStore } from '../types.js';
import { toIsoDate } from './util.js';

/** Minimal structural type satisfied by `pg.Pool` and `pg.Client`. */
export interface PgQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const SNAPSHOT_SCHEMA_SQL = `
  create table if not exists snapshot (
    id                     uuid primary key,
    run_id                 text unique not null,
    created_at             timestamptz not null,
    snapshot_day           date not null,
    run_type               text not null check (run_type in ('scheduled','ondemand','replay')),
    status                 text not null check (status in ('good','degraded','failed')),
    data_completeness      numeric(4,3) not null,
    score_basis            text not null check (score_basis in ('cross_sectional','blended','reference')),
    metric_schema_version  integer not null,
    rates_as_of            date not null,
    universe_hash          text not null,
    provider               text not null,
    display_delayed        boolean not null,
    filter_defaults        jsonb not null,
    notes                  text,
    universe               jsonb not null default '[]'
  );
  create index if not exists snapshot_created_at_idx on snapshot (created_at desc);

  create table if not exists snapshot_row (
    snapshot_id       uuid not null references snapshot(id) on delete cascade,
    snapshot_day      date not null,
    occ_symbol        text not null,
    symbol            text not null,
    expiration        date not null,
    strike            numeric(18,6) not null,
    multiplier        integer not null,
    dte               integer not null,
    spot              numeric(18,6) not null,
    spot_adj          numeric(18,6) not null,
    daily_change_pct  numeric(9,6),
    bid               numeric(18,6),
    ask               numeric(18,6),
    mid               numeric(18,6) not null,
    last              numeric(18,6),
    volume            integer,
    open_interest     integer,
    quote_as_of       timestamptz not null,
    entry_credit      numeric(18,6),
    entry_credit_100  numeric(18,6),
    mid_credit        numeric(18,6),
    slippage_k        numeric(4,3),
    iv                numeric(9,6),
    iv_vs_fitted      numeric(9,6),
    iv_rank           numeric(6,3),
    iv_pctile         numeric(6,3),
    put_skew_25d      numeric(9,6),
    delta             numeric(9,6),
    gamma             numeric(12,8),
    theta_day         numeric(12,8),
    daily_decay       numeric(12,8),
    vega              numeric(12,8),
    moneyness_pct     numeric(9,6),
    spread_pct        numeric(9,6),
    vol_oi            numeric(12,6),
    decay_yield       numeric(12,8),
    theta_vega        numeric(12,6),
    breakeven         numeric(18,6),
    be_pct            numeric(9,6),
    prob_itm          numeric(9,6),
    pop               numeric(9,6),
    em_distance       numeric(9,6),
    csp_capital_100   numeric(18,6),
    regt_capital_100  numeric(18,6),
    ann_roc           numeric(9,6),
    capital_basis     text check (capital_basis in ('csp','regt')),
    ev_100            numeric(18,6),
    max_loss_100      numeric(18,6),
    ev_to_maxloss     numeric(9,6),
    credit_to_maxloss numeric(9,6),
    sigma_f           numeric(9,6),
    vrp_haircut       numeric(6,4),
    mu                numeric(9,6),
    score             numeric(9,4),
    score_components  jsonb,
    model_caution     jsonb not null,
    assignment_watch  boolean not null,
    is_candidate      boolean not null,
    excluded_reason   text,
    primary key (snapshot_id, occ_symbol)
  );
  create index if not exists snapshot_row_score_idx    on snapshot_row (snapshot_id, score desc nulls last);
  create index if not exists snapshot_row_symbol_idx   on snapshot_row (snapshot_id, symbol, score desc);
  create index if not exists snapshot_row_contract_idx on snapshot_row (occ_symbol, snapshot_day);

  create table if not exists ingestion_run (
    run_id                        text primary key,
    started_at                    timestamptz,
    finished_at                   timestamptz,
    names_ok                      integer,
    names_failed                  integer,
    contracts_priced              integer,
    iv_solve_failures             integer,
    candidates_found              integer,
    greek_xcheck_median_abs_pct   numeric(6,3),
    status                        text
  );

  create table if not exists ingestion_log (
    run_id      text not null,
    symbol      text not null,
    stage       text not null,
    outcome     text not null check (outcome in ('ok','skipped','failed')),
    error       text,
    duration_ms integer,
    seq         integer not null,
    primary key (run_id, seq)
  );
`;

export class PgSnapshotStore implements SnapshotStore {
  constructor(private readonly db: PgQueryable) {}

  static async connect(connectionString: string): Promise<{ store: PgSnapshotStore; close: () => Promise<void> }> {
    const pg = (await import('pg')) as unknown as { default: { Pool: new (c: { connectionString: string }) => PgQueryable & { end(): Promise<void> } } };
    const pool = new pg.default.Pool({ connectionString });
    return { store: new PgSnapshotStore(pool), close: () => pool.end() };
  }

  async migrate(): Promise<void> {
    await this.db.query(SNAPSHOT_SCHEMA_SQL);
  }

  async saveSnapshot(s: Snapshot): Promise<void> {
    const m = s.meta;
    await this.db.query('delete from snapshot where run_id = $1', [m.runId]);
    await this.db.query(
      `insert into snapshot (id, run_id, created_at, snapshot_day, run_type, status,
         data_completeness, score_basis, metric_schema_version, rates_as_of,
         universe_hash, provider, display_delayed, filter_defaults, notes, universe)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        m.id, m.runId, m.createdAt, m.snapshotDay, m.runType, m.status,
        m.dataCompleteness, m.scoreBasis, m.metricSchemaVersion, m.ratesAsOf,
        m.universeHash, m.provider, m.displayDelayed, JSON.stringify(m.filterDefaults), m.notes ?? null,
        JSON.stringify(s.universe ?? []),
      ],
    );

    for (const r of s.rows) await this.insertRow(m.id, m.snapshotDay, r);
    await this.upsertRun(s.run);
    await this.db.query('delete from ingestion_log where run_id = $1', [m.runId]);
    for (let i = 0; i < s.logs.length; i++) await this.insertLog(s.logs[i]!, i);
  }

  private async insertRow(snapshotId: string, snapshotDay: string, r: SnapshotRow): Promise<void> {
    await this.db.query(
      `insert into snapshot_row (
         snapshot_id, snapshot_day, occ_symbol, symbol, expiration, strike, multiplier, dte,
         spot, spot_adj, daily_change_pct, bid, ask, mid, last, volume, open_interest, quote_as_of,
         entry_credit, entry_credit_100, mid_credit, slippage_k,
         iv, iv_vs_fitted, iv_rank, iv_pctile, put_skew_25d,
         delta, gamma, theta_day, daily_decay, vega,
         moneyness_pct, spread_pct, vol_oi, decay_yield, theta_vega,
         breakeven, be_pct, prob_itm, pop, em_distance,
         csp_capital_100, regt_capital_100, ann_roc, capital_basis,
         ev_100, max_loss_100, ev_to_maxloss, credit_to_maxloss, sigma_f, vrp_haircut, mu,
         score, score_components, model_caution, assignment_watch, is_candidate, excluded_reason)
       values (${range(59)})`,
      [
        snapshotId, snapshotDay, r.occSymbol, r.symbol, r.expiration, r.strike, r.multiplier, r.dte,
        r.spot, r.spotAdj, r.dailyChangePct, r.bid, r.ask, r.mid, r.last, r.volume, r.openInterest, r.quoteAsOf,
        r.entryCredit, r.entryCredit100, r.midCredit, r.slippageK,
        r.iv, r.ivVsFitted, r.ivRank, r.ivPctile, r.putSkew25d,
        r.delta, r.gamma, r.thetaDay, r.dailyDecay, r.vega,
        r.moneynessPct, r.spreadPct, r.volOi, r.decayYield, r.thetaVega,
        r.breakeven, r.bePct, r.probItm, r.pop, r.emDistance,
        r.cspCapital100, r.regtCapital100, r.annRoc, r.capitalBasis,
        r.ev100, r.maxLoss100, r.evToMaxloss, r.creditToMaxloss, r.sigmaF, r.vrpHaircut, r.mu,
        r.score, r.scoreComponents ? JSON.stringify(r.scoreComponents) : null,
        JSON.stringify(r.modelCaution), r.assignmentWatch, r.isCandidate, r.excludedReason,
      ],
    );
  }

  private async upsertRun(run: IngestionRun): Promise<void> {
    await this.db.query(
      `insert into ingestion_run (run_id, started_at, finished_at, names_ok, names_failed,
         contracts_priced, iv_solve_failures, candidates_found, greek_xcheck_median_abs_pct, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (run_id) do update set
         finished_at = excluded.finished_at, names_ok = excluded.names_ok,
         names_failed = excluded.names_failed, contracts_priced = excluded.contracts_priced,
         iv_solve_failures = excluded.iv_solve_failures, candidates_found = excluded.candidates_found,
         greek_xcheck_median_abs_pct = excluded.greek_xcheck_median_abs_pct, status = excluded.status`,
      [
        run.runId, run.startedAt, run.finishedAt, run.namesOk, run.namesFailed,
        run.contractsPriced, run.ivSolveFailures, run.candidatesFound,
        run.greekXcheckMedianAbsPct, run.status,
      ],
    );
  }

  private async insertLog(entry: IngestionLogEntry, seq: number): Promise<void> {
    await this.db.query(
      `insert into ingestion_log (run_id, symbol, stage, outcome, error, duration_ms, seq)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [entry.runId, entry.symbol, entry.stage, entry.outcome, entry.error ?? null, entry.durationMs, seq],
    );
  }

  async list(limit: number): Promise<SnapshotMeta[]> {
    const { rows } = await this.db.query(
      'select * from snapshot order by created_at desc limit $1',
      [limit],
    );
    return rows.map(rowToMeta);
  }

  async latest(): Promise<Snapshot | null> {
    const { rows } = await this.db.query(
      `select * from snapshot where status <> 'failed' order by created_at desc limit 1`,
    );
    const meta = rows[0] ? rowToMeta(rows[0]) : null;
    return meta ? this.hydrate(meta) : null;
  }

  async getById(id: string): Promise<Snapshot | null> {
    const { rows } = await this.db.query('select * from snapshot where id = $1', [id]);
    return rows[0] ? this.hydrate(rowToMeta(rows[0])) : null;
  }

  async getByRunId(runId: string): Promise<Snapshot | null> {
    const { rows } = await this.db.query('select * from snapshot where run_id = $1', [runId]);
    return rows[0] ? this.hydrate(rowToMeta(rows[0])) : null;
  }

  private async hydrate(meta: SnapshotMeta): Promise<Snapshot> {
    const rowsRes = await this.db.query(
      'select * from snapshot_row where snapshot_id = $1 order by ev_to_maxloss desc nulls last',
      [meta.id],
    );
    const runRes = await this.db.query('select * from ingestion_run where run_id = $1', [meta.runId]);
    const logRes = await this.db.query(
      'select * from ingestion_log where run_id = $1 order by seq',
      [meta.runId],
    );
    const snapRes = await this.db.query('select universe from snapshot where id = $1', [meta.id]);
    return {
      meta,
      rows: rowsRes.rows.map(dbRowToSnapshotRow),
      universe: (asJson(snapRes.rows[0]?.['universe']) as Snapshot['universe']) ?? [],
      run: dbRowToRun(runRes.rows[0] ?? {}, meta),
      logs: logRes.rows.map((l) => dbRowToLog(l, meta.runId)),
    };
  }
}

function range(n: number): string {
  return Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',');
}

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

function rowToMeta(r: Record<string, unknown>): SnapshotMeta {
  return {
    id: String(r['id']),
    runId: String(r['run_id']),
    createdAt: new Date(r['created_at'] as string).toISOString(),
    snapshotDay: toIsoDate(r['snapshot_day']),
    runType: r['run_type'] as SnapshotMeta['runType'],
    status: r['status'] as SnapshotMeta['status'],
    dataCompleteness: num(r['data_completeness']),
    scoreBasis: r['score_basis'] as SnapshotMeta['scoreBasis'],
    metricSchemaVersion: num(r['metric_schema_version']),
    ratesAsOf: toIsoDate(r['rates_as_of']),
    universeHash: String(r['universe_hash']),
    provider: String(r['provider']),
    displayDelayed: Boolean(r['display_delayed']),
    filterDefaults: asJson(r['filter_defaults']) as SnapshotMeta['filterDefaults'],
    notes: (r['notes'] as string | null) ?? undefined,
  };
}

function asJson(v: unknown): unknown {
  return typeof v === 'string' ? JSON.parse(v) : v;
}

function dbRowToSnapshotRow(r: Record<string, unknown>): SnapshotRow {
  return {
    occSymbol: String(r['occ_symbol']),
    symbol: String(r['symbol']),
    expiration: toIsoDate(r['expiration']),
    strike: num(r['strike']),
    multiplier: num(r['multiplier']),
    dte: num(r['dte']),
    spot: num(r['spot']),
    spotAdj: num(r['spot_adj']),
    dailyChangePct: numOrNull(r['daily_change_pct']),
    bid: num(r['bid']),
    ask: num(r['ask']),
    mid: num(r['mid']),
    last: numOrNull(r['last']),
    volume: num(r['volume']),
    openInterest: num(r['open_interest']),
    quoteAsOf: new Date(r['quote_as_of'] as string).toISOString(),
    entryCredit: numOrNull(r['entry_credit']),
    entryCredit100: numOrNull(r['entry_credit_100']),
    midCredit: num(r['mid_credit']),
    slippageK: num(r['slippage_k']),
    iv: numOrNull(r['iv']),
    ivVsFitted: numOrNull(r['iv_vs_fitted']),
    ivRank: numOrNull(r['iv_rank']),
    ivPctile: numOrNull(r['iv_pctile']),
    putSkew25d: numOrNull(r['put_skew_25d']),
    delta: numOrNull(r['delta']),
    gamma: numOrNull(r['gamma']),
    thetaDay: numOrNull(r['theta_day']),
    dailyDecay: numOrNull(r['daily_decay']),
    vega: numOrNull(r['vega']),
    moneynessPct: num(r['moneyness_pct']),
    spreadPct: num(r['spread_pct']),
    volOi: numOrNull(r['vol_oi']),
    decayYield: numOrNull(r['decay_yield']),
    thetaVega: numOrNull(r['theta_vega']),
    breakeven: numOrNull(r['breakeven']),
    bePct: numOrNull(r['be_pct']),
    probItm: numOrNull(r['prob_itm']),
    pop: numOrNull(r['pop']),
    emDistance: numOrNull(r['em_distance']),
    cspCapital100: numOrNull(r['csp_capital_100']),
    regtCapital100: numOrNull(r['regt_capital_100']),
    annRoc: numOrNull(r['ann_roc']),
    capitalBasis: (r['capital_basis'] as 'csp' | 'regt' | null) ?? null,
    ev100: numOrNull(r['ev_100']),
    maxLoss100: numOrNull(r['max_loss_100']),
    evToMaxloss: numOrNull(r['ev_to_maxloss']),
    creditToMaxloss: numOrNull(r['credit_to_maxloss']),
    sigmaF: numOrNull(r['sigma_f']),
    vrpHaircut: numOrNull(r['vrp_haircut']),
    mu: numOrNull(r['mu']),
    score: numOrNull(r['score']),
    scoreComponents: (asJson(r['score_components']) as Record<string, number> | null) ?? null,
    modelCaution: asJson(r['model_caution']) as SnapshotRow['modelCaution'],
    assignmentWatch: Boolean(r['assignment_watch']),
    isCandidate: Boolean(r['is_candidate']),
    excludedReason: (r['excluded_reason'] as string | null) ?? null,
  };
}

function dbRowToRun(r: Record<string, unknown>, meta: SnapshotMeta): IngestionRun {
  return {
    runId: meta.runId,
    startedAt: r['started_at'] ? new Date(r['started_at'] as string).toISOString() : meta.createdAt,
    finishedAt: r['finished_at'] ? new Date(r['finished_at'] as string).toISOString() : meta.createdAt,
    namesOk: num(r['names_ok'] ?? 0),
    namesFailed: num(r['names_failed'] ?? 0),
    contractsPriced: num(r['contracts_priced'] ?? 0),
    ivSolveFailures: num(r['iv_solve_failures'] ?? 0),
    candidatesFound: num(r['candidates_found'] ?? 0),
    greekXcheckMedianAbsPct: numOrNull(r['greek_xcheck_median_abs_pct']),
    status: (r['status'] as IngestionRun['status']) ?? meta.status,
  };
}

function dbRowToLog(r: Record<string, unknown>, runId: string): IngestionLogEntry {
  return {
    runId,
    symbol: String(r['symbol']),
    stage: r['stage'] as IngestionLogEntry['stage'],
    outcome: r['outcome'] as IngestionLogEntry['outcome'],
    error: (r['error'] as string | null) ?? undefined,
    durationMs: num(r['duration_ms'] ?? 0),
  };
}
