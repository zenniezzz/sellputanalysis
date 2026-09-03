import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonFrozenComparisonStore } from './frozen-comparison.js';
import { JsonSnapshotBookmarkStore } from './snapshot-bookmark.js';

describe('JsonFrozenComparisonStore', () => {
  let file: string;
  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'pss-fc-')), 'frozen-comparisons.json');
  });
  afterEach(async () => {
    await rm(file, { force: true });
  });

  it('creates and reads back, normalizing occ symbols', async () => {
    const s = new JsonFrozenComparisonStore(file);
    const c = await s.create({
      userId: 'u1',
      snapshotRunId: '2026-09-03-1000-scheduled',
      occSymbols: [' NVDA  261016P00210000 ', 'NVDA  261016P00210000', 'AMD  261016P00420000'],
    });
    expect(c.id).toMatch(/[0-9a-f-]{36}/);
    expect(c.occSymbols).toEqual(['NVDA  261016P00210000', 'AMD  261016P00420000']);
    expect((await s.get(c.id))?.snapshotRunId).toBe('2026-09-03-1000-scheduled');
  });

  it('defaults userId to null and returns null for an unknown id', async () => {
    const s = new JsonFrozenComparisonStore(file);
    const c = await s.create({ snapshotRunId: 'r', occSymbols: ['X'] });
    expect(c.userId).toBeNull();
    expect(await s.get('nope')).toBeNull();
  });

  it('keeps multiple comparisons', async () => {
    const s = new JsonFrozenComparisonStore(file);
    const a = await s.create({ snapshotRunId: 'r', occSymbols: ['A'] });
    const b = await s.create({ snapshotRunId: 'r', occSymbols: ['B'] });
    expect((await s.get(a.id))?.occSymbols).toEqual(['A']);
    expect((await s.get(b.id))?.occSymbols).toEqual(['B']);
  });
});

describe('JsonSnapshotBookmarkStore', () => {
  let file: string;
  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'pss-bm-')), 'snapshot-bookmarks.json');
  });
  afterEach(async () => {
    await rm(file, { force: true });
  });

  it('lists a user\'s bookmarks newest-first and isolates by user', async () => {
    const s = new JsonSnapshotBookmarkStore(file);
    await s.create({ userId: 'u1', name: 'Older', snapshotRunId: 'r1', filterQuery: 'deltaHi=0.3' });
    await new Promise((r) => setTimeout(r, 5));
    await s.create({ userId: 'u1', name: 'Newer', snapshotRunId: 'r2', filterQuery: '' });
    await s.create({ userId: 'u2', name: 'Other', snapshotRunId: 'r3', filterQuery: '' });

    const list = await s.list('u1');
    expect(list.map((b) => b.name)).toEqual(['Newer', 'Older']);
    expect(await s.list('u2')).toHaveLength(1);
    expect(await s.list(null)).toHaveLength(0);
  });

  it('deletes only the owner\'s bookmark', async () => {
    const s = new JsonSnapshotBookmarkStore(file);
    const a = await s.create({ userId: 'u1', name: 'A', snapshotRunId: 'r', filterQuery: '' });
    await s.delete('u2', a.id); // wrong owner — no-op
    expect(await s.get(a.id)).not.toBeNull();
    await s.delete('u1', a.id);
    expect(await s.get(a.id)).toBeNull();
  });

  it('supports an anonymous (null user) namespace', async () => {
    const s = new JsonSnapshotBookmarkStore(file);
    await s.create({ name: 'Anon', snapshotRunId: 'r', filterQuery: '' });
    expect(await s.list(null)).toHaveLength(1);
    expect(await s.list('u1')).toHaveLength(0);
  });
});
