import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IvSample } from '@pss/pipeline';
import { JsonIvHistoryStore } from './iv-history.js';

const sample = (symbol: string, date: string, iv: number): IvSample => ({
  symbol,
  date,
  atmIv30d: iv,
  hv20: 0.25,
  hv252: 0.3,
  putSkew25d: 0.02,
  source: 'own',
});

describe('JsonIvHistoryStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pss-iv-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends, dedupes by date, and returns ascending', async () => {
    const s = new JsonIvHistoryStore(dir);
    await s.append([sample('AAA', '2026-09-02', 0.3), sample('AAA', '2026-09-01', 0.28)]);
    await s.append([sample('AAA', '2026-09-02', 0.31)]); // same date → replace
    const hist = await s.history('AAA');
    expect(hist.map((h) => h.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(hist[1]!.atmIv30d).toBe(0.31);
  });

  it('tracks the latest date and known symbols', async () => {
    const s = new JsonIvHistoryStore(dir);
    await s.append([sample('AAA', '2026-09-01', 0.3), sample('BBB', '2026-09-03', 0.4)]);
    expect(await s.latestDate('AAA')).toBe('2026-09-01');
    expect(await s.latestDate('CCC')).toBeNull();
    expect((await s.symbols()).sort()).toEqual(['AAA', 'BBB']);
  });

  it('trims by sinceDays', async () => {
    const s = new JsonIvHistoryStore(dir);
    const old = new Date(Date.now() - 500 * 86_400_000).toISOString().slice(0, 10);
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    await s.append([sample('AAA', old, 0.2), sample('AAA', recent, 0.3)]);
    expect(await s.history('AAA', 30)).toHaveLength(1);
  });
});
