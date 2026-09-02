import type { ReferenceStats } from '@pss/options';
import { aggregate, rollUp, type DailyMetricAgg, type MetricReferenceStore } from '../metric-reference.js';
import type { PgQueryable } from './store.js';

export class PgMetricReferenceStore implements MetricReferenceStore {
  constructor(private readonly db: PgQueryable) {}

  async migrate(): Promise<void> {
    await this.db.query(`
      create table if not exists metric_sample_daily (
        metric  text not null,
        date    date not null,
        sum     double precision not null,
        sum_sq  double precision not null,
        count   integer not null,
        primary key (metric, date)
      );
    `);
  }

  async append(date: string, byMetric: Record<string, number[]>): Promise<void> {
    for (const [metric, values] of Object.entries(byMetric)) {
      if (values.length === 0) continue;
      const a = aggregate(values);
      await this.db.query(
        `insert into metric_sample_daily (metric, date, sum, sum_sq, count)
         values ($1,$2,$3,$4,$5)
         on conflict (metric, date) do update set sum = excluded.sum, sum_sq = excluded.sum_sq, count = excluded.count`,
        [metric, date, a.sum, a.sumSq, a.count],
      );
    }
  }

  async reference(asOf: string, windowDays = 365): Promise<ReferenceStats> {
    const { rows } = await this.db.query(
      `select metric, date, sum, sum_sq, count from metric_sample_daily
       where date > $1::date - $2::int and date <= $1::date`,
      [asOf, windowDays],
    );
    const agg: DailyMetricAgg[] = rows.map((r) => ({
      metric: String(r['metric']),
      date: String(r['date']).slice(0, 10),
      sum: Number(r['sum']),
      sumSq: Number(r['sum_sq']),
      count: Number(r['count']),
    }));
    return rollUp(agg, asOf, windowDays);
  }
}
