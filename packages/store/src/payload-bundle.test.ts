import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PayloadEntry } from '@pss/market-data';
import { FilePayloadStore } from './payload-bundle.js';

const ENTRY: PayloadEntry = {
  kind: 'underlying',
  symbol: 'AAA',
  result: { ok: true, value: { spot: 100 } },
  capturedAt: '2026-09-02T14:00:00Z',
};

describe('FilePayloadStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pss-bundle-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('flushes and reloads entries with a manifest', async () => {
    const store = new FilePayloadStore(dir, '2026-09-02-1400-scheduled', '2026-09-02');
    store.record(ENTRY);
    store.record({ ...ENTRY, kind: 'chain', arg: '2026-10-16' });
    await store.flush();

    const loaded = await FilePayloadStore.load(dir, '2026-09-02-1400-scheduled');
    expect(loaded).toEqual([ENTRY, { ...ENTRY, kind: 'chain', arg: '2026-10-16' }]);

    const manifest = await FilePayloadStore.loadManifest(dir, '2026-09-02-1400-scheduled');
    expect(manifest.entryCount).toBe(2);
    expect(manifest.byKind).toEqual({ underlying: 1, chain: 1 });
  });
});
