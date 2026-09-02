/**
 * Rolling reference distributions for the composite score's z_ref (plan §6.2,
 * §9.1, milestone M2.5).
 *
 * Each run appends the day's candidate metric values as a pooled daily aggregate
 * (sum / sumSq / count). `reference(asOf)` rolls the trailing window up into
 * mean / stddev / nDays per metric.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReferenceStats } from '@pss/options';

export interface DailyMetricAgg {
  date: string;
  metric: string;
  sum: number;
  sumSq: number;
  count: number;
}

export interface MetricReferenceStore {
  append(date: string, byMetric: Record<string, number[]>): Promise<void>;
  reference(asOf: string, windowDays?: number): Promise<ReferenceStats>;
}

export function aggregate(values: number[]): { sum: number; sumSq: number; count: number } {
  let sum = 0;
  let sumSq = 0;
  for (const v of values) {
    sum += v;
    sumSq += v * v;
  }
  return { sum, sumSq, count: values.length };
}

export function rollUp(rows: DailyMetricAgg[], asOf: string, windowDays: number): ReferenceStats {
  const cutoff = new Date(new Date(`${asOf}T00:00:00Z`).getTime() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const byMetric = new Map<string, { sum: number; sumSq: number; count: number; dates: Set<string> }>();

  for (const r of rows) {
    if (r.date < cutoff || r.date > asOf) continue;
    const acc = byMetric.get(r.metric) ?? { sum: 0, sumSq: 0, count: 0, dates: new Set<string>() };
    acc.sum += r.sum;
    acc.sumSq += r.sumSq;
    acc.count += r.count;
    acc.dates.add(r.date);
    byMetric.set(r.metric, acc);
  }

  const out: ReferenceStats = {};
  for (const [metric, acc] of byMetric) {
    if (acc.count < 2) continue;
    const mean = acc.sum / acc.count;
    const variance = Math.max(acc.sumSq / acc.count - mean * mean, 0);
    (out as Record<string, unknown>)[metric] = {
      mean,
      stddev: Math.sqrt(variance),
      nDays: acc.dates.size,
    };
  }
  return out;
}

export class JsonMetricReferenceStore implements MetricReferenceStore {
  constructor(private readonly file: string) {}

  private async read(): Promise<DailyMetricAgg[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as DailyMetricAgg[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async append(date: string, byMetric: Record<string, number[]>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const existing = await this.read();
    const keep = existing.filter((r) => !(r.date === date && r.metric in byMetric));
    for (const [metric, values] of Object.entries(byMetric)) {
      if (values.length === 0) continue;
      keep.push({ date, metric, ...aggregate(values) });
    }
    keep.sort((a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric));
    await writeFile(this.file, `${JSON.stringify(keep, null, 2)}\n`);
  }

  async reference(asOf: string, windowDays = 365): Promise<ReferenceStats> {
    return rollUp(await this.read(), asOf, windowDays);
  }
}
