import type { IvHistoryStore, IvSample } from '../iv-history.js';
import type { PgQueryable } from './store.js';
import { toIsoDate } from './util.js';

export class PgIvHistoryStore implements IvHistoryStore {
  constructor(private readonly db: PgQueryable) {}

  async migrate(): Promise<void> {
    await this.db.query(`
      create table if not exists iv_history (
        symbol        text not null,
        date          date not null,
        atm_iv_30d    numeric(9,6) not null,
        hv20          numeric(9,6),
        hv252         numeric(9,6),
        put_skew_25d  numeric(9,6),
        source        text not null check (source in ('own','orats_backfill','hv_proxy')),
        primary key (symbol, date)
      );
      create index if not exists iv_history_symbol_date_idx on iv_history (symbol, date desc);
    `);
  }

  async append(samples: IvSample[]): Promise<void> {
    for (const s of samples) {
      await this.db.query(
        `insert into iv_history (symbol, date, atm_iv_30d, hv20, hv252, put_skew_25d, source)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (symbol, date) do update set
           atm_iv_30d = excluded.atm_iv_30d, hv20 = excluded.hv20, hv252 = excluded.hv252,
           put_skew_25d = excluded.put_skew_25d, source = excluded.source`,
        [s.symbol, s.date, s.atmIv30d, s.hv20, s.hv252, s.putSkew25d, s.source],
      );
    }
  }

  async history(symbol: string, sinceDays?: number): Promise<IvSample[]> {
    const clause = sinceDays == null ? '' : `and date >= current_date - $2::int`;
    const params: unknown[] = sinceDays == null ? [symbol] : [symbol, sinceDays];
    const { rows } = await this.db.query(
      `select * from iv_history where symbol = $1 ${clause} order by date asc`,
      params,
    );
    return rows.map(toSample);
  }

  async latestDate(symbol: string): Promise<string | null> {
    const { rows } = await this.db.query(
      'select max(date) as d from iv_history where symbol = $1',
      [symbol],
    );
    const d = rows[0]?.['d'];
    return d ? toIsoDate(d) : null;
  }

  async symbols(): Promise<string[]> {
    const { rows } = await this.db.query('select distinct symbol from iv_history order by symbol');
    return rows.map((r) => String(r['symbol']));
  }
}

function toSample(r: Record<string, unknown>): IvSample {
  return {
    symbol: String(r['symbol']),
    date: toIsoDate(r['date']),
    atmIv30d: Number(r['atm_iv_30d']),
    hv20: r['hv20'] == null ? null : Number(r['hv20']),
    hv252: r['hv252'] == null ? null : Number(r['hv252']),
    putSkew25d: r['put_skew_25d'] == null ? null : Number(r['put_skew_25d']),
    source: r['source'] as IvSample['source'],
  };
}
