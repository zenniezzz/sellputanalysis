import type { CloseTradeInput, OpenTradeInput, PaperTrade } from '@pss/tracker';
import { applyClose } from '@pss/tracker';
import { newPaperTrade, type PaperTradeStore } from '../paper-trade.js';
import type { PgQueryable } from './store.js';

const COLS = `id, user_id, created_at, snapshot_run_id, occ_symbol, symbol, expiration, strike,
  multiplier, contracts, entry_credit, actual_fill_credit, entry_spot, breakeven,
  modeled_pop, modeled_prob_itm, modeled_ev_100, sigma_f, delta, dte_at_entry,
  closed_at, outcome, terminal_spot, exit_credit, realized_pnl_100, notes`;

function toTrade(r: Record<string, unknown>): PaperTrade {
  const n = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    id: String(r['id']),
    userId: (r['user_id'] as string | null) ?? null,
    createdAt: new Date(r['created_at'] as string).toISOString(),
    snapshotRunId: String(r['snapshot_run_id']),
    occSymbol: String(r['occ_symbol']),
    symbol: String(r['symbol']),
    expiration: String(r['expiration']).slice(0, 10),
    strike: Number(r['strike']),
    multiplier: Number(r['multiplier']),
    contracts: Number(r['contracts']),
    entryCredit: Number(r['entry_credit']),
    actualFillCredit: n(r['actual_fill_credit']),
    entrySpot: Number(r['entry_spot']),
    breakeven: Number(r['breakeven']),
    modeledPop: n(r['modeled_pop']),
    modeledProbItm: n(r['modeled_prob_itm']),
    modeledEv100: n(r['modeled_ev_100']),
    sigmaF: n(r['sigma_f']),
    delta: n(r['delta']),
    dteAtEntry: Number(r['dte_at_entry']),
    closedAt: r['closed_at'] ? new Date(r['closed_at'] as string).toISOString() : null,
    outcome: (r['outcome'] as PaperTrade['outcome']) ?? null,
    terminalSpot: n(r['terminal_spot']),
    exitCredit: n(r['exit_credit']),
    realizedPnl100: n(r['realized_pnl_100']),
    notes: (r['notes'] as string | null) ?? null,
  };
}

export class PgPaperTradeStore implements PaperTradeStore {
  constructor(private readonly db: PgQueryable) {}

  async migrate(): Promise<void> {
    await this.db.query(`
      create table if not exists paper_trade (
        id uuid primary key,
        user_id uuid,
        created_at timestamptz not null,
        snapshot_run_id text not null,
        occ_symbol text not null,
        symbol text not null,
        expiration date not null,
        strike numeric(18,6) not null,
        multiplier integer not null,
        contracts integer not null,
        entry_credit numeric(18,6) not null,
        actual_fill_credit numeric(18,6),
        entry_spot numeric(18,6) not null,
        breakeven numeric(18,6) not null,
        modeled_pop numeric(9,6),
        modeled_prob_itm numeric(9,6),
        modeled_ev_100 numeric(18,6),
        sigma_f numeric(9,6),
        delta numeric(9,6),
        dte_at_entry integer not null,
        closed_at timestamptz,
        outcome text check (outcome in ('expired_otm','assigned','closed_early','rolled')),
        terminal_spot numeric(18,6),
        exit_credit numeric(18,6),
        realized_pnl_100 numeric(18,6),
        notes text
      );
      create index if not exists paper_trade_user_idx on paper_trade (user_id, created_at desc);
    `);
  }

  private async insert(t: PaperTrade): Promise<void> {
    await this.db.query(
      `insert into paper_trade (${COLS}) values (${Array.from({ length: 26 }, (_, i) => `$${i + 1}`).join(',')})`,
      [
        t.id, t.userId, t.createdAt, t.snapshotRunId, t.occSymbol, t.symbol, t.expiration, t.strike,
        t.multiplier, t.contracts, t.entryCredit, t.actualFillCredit, t.entrySpot, t.breakeven,
        t.modeledPop, t.modeledProbItm, t.modeledEv100, t.sigmaF, t.delta, t.dteAtEntry,
        t.closedAt, t.outcome, t.terminalSpot, t.exitCredit, t.realizedPnl100, t.notes,
      ],
    );
  }

  async list(userId: string | null): Promise<PaperTrade[]> {
    const { rows } = await this.db.query(
      userId == null
        ? `select ${COLS} from paper_trade where user_id is null order by created_at desc`
        : `select ${COLS} from paper_trade where user_id = $1 order by created_at desc`,
      userId == null ? [] : [userId],
    );
    return rows.map(toTrade);
  }

  async open(userId: string | null, input: OpenTradeInput): Promise<PaperTrade> {
    const t = newPaperTrade(userId, input);
    await this.insert(t);
    return t;
  }

  async close(userId: string | null, id: string, input: CloseTradeInput): Promise<PaperTrade | null> {
    const { rows } = await this.db.query(`select ${COLS} from paper_trade where id = $1`, [id]);
    const t = rows[0] ? toTrade(rows[0]) : null;
    if (!t || t.userId !== userId) return null;
    const closed = applyClose(t, input, new Date().toISOString());
    await this.db.query(
      `update paper_trade set closed_at=$2, outcome=$3, terminal_spot=$4, exit_credit=$5, realized_pnl_100=$6, notes=$7
       where id=$1`,
      [id, closed.closedAt, closed.outcome, closed.terminalSpot, closed.exitCredit, closed.realizedPnl100, closed.notes],
    );
    return closed;
  }

  async delete(userId: string | null, id: string): Promise<void> {
    await this.db.query(
      userId == null
        ? `delete from paper_trade where id = $1 and user_id is null`
        : `delete from paper_trade where id = $1 and user_id = $2`,
      userId == null ? [id] : [id, userId],
    );
  }

  async get(id: string): Promise<PaperTrade | null> {
    const { rows } = await this.db.query(`select ${COLS} from paper_trade where id = $1`, [id]);
    return rows[0] ? toTrade(rows[0]) : null;
  }
}
