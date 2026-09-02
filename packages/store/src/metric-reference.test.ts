import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonMetricReferenceStore, rollUp, type DailyMetricAgg } from './metric-reference.js';

describe('rollUp', () => {
  it('pools daily aggregates into mean / stddev / nDays over the window', () => {
    const rows: DailyMetricAgg[] = [
      { date: '2026-08-01', metric: 'annRoc', sum: 10, sumSq: 22, count: 5 }, // values around 2
      { date: '2026-08-02', metric: 'annRoc', sum: 12, sumSq: 30, count: 5 },
    ];
    const ref = rollUp(rows, '2026-08-03', 365).annRoc!;
    const mean = 22 / 10;
    expect(ref.mean).toBeCloseTo(mean, 10);
    expect(ref.stddev).toBeCloseTo(Math.sqrt(52 / 10 - mean * mean), 10);
    expect(ref.nDays).toBe(2);
  });

  it('excludes samples outside the trailing window', () => {
    const rows: DailyMetricAgg[] = [
      { date: '2025-01-01', metric: 'ivRank', sum: 100, sumSq: 5000, count: 2 },
      { date: '2026-08-01', metric: 'ivRank', sum: 90, sumSq: 4100, count: 2 },
    ];
    expect(rollUp(rows, '2026-08-15', 30).ivRank!.nDays).toBe(1);
  });

  it('drops a metric with fewer than 2 samples', () => {
    expect(rollUp([{ date: '2026-08-01', metric: 'x', sum: 1, sumSq: 1, count: 1 }], '2026-08-02', 365)).toEqual({});
  });
});

describe('JsonMetricReferenceStore', () => {
  let file: string;
  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'pss-mr-')), 'metric-samples.json');
  });
  afterEach(async () => {
    await rm(file, { force: true });
  });

  it('appends, replaces same-day, and rolls up', async () => {
    const s = new JsonMetricReferenceStore(file);
    await s.append('2026-08-01', { annRoc: [0.1, 0.2, 0.3] });
    await s.append('2026-08-01', { annRoc: [0.15, 0.25] }); // replaces the day
    await s.append('2026-08-02', { annRoc: [0.2, 0.4] });

    const ref = await s.reference('2026-08-03');
    expect(ref.annRoc!.nDays).toBe(2);
    expect(ref.annRoc!.mean).toBeCloseTo((0.15 + 0.25 + 0.2 + 0.4) / 4, 10);
  });
});
