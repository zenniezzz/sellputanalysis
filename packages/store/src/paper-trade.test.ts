import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { calibrationReport } from '@pss/tracker';
import { JsonPaperTradeStore } from './paper-trade.js';

const OPEN = {
  snapshotRunId: 'r1',
  occSymbol: 'NVDA  261016P00200000',
  symbol: 'NVDA',
  expiration: '2026-10-16',
  strike: 200,
  entryCredit: 4,
  entrySpot: 220,
  breakeven: 196,
  modeledPop: 0.8,
  modeledEv100: 120,
  dteAtEntry: 40,
};

describe('JsonPaperTradeStore', () => {
  let file: string;
  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'pss-pt-')), 'paper-trades.json');
  });
  afterEach(async () => {
    await rm(file, { force: true });
  });

  it('opens, lists (newest first), and isolates by user', async () => {
    const s = new JsonPaperTradeStore(file);
    await s.open('u1', OPEN);
    await new Promise((r) => setTimeout(r, 3));
    await s.open('u1', { ...OPEN, symbol: 'AMD', occSymbol: 'AMD  x' });
    await s.open('u2', OPEN);

    const list = await s.list('u1');
    expect(list.map((t) => t.symbol)).toEqual(['AMD', 'NVDA']);
    expect(list[0]!.contracts).toBe(1);
    expect(await s.list('u2')).toHaveLength(1);
  });

  it('closes a trade and computes realized P&L', async () => {
    const s = new JsonPaperTradeStore(file);
    const t = await s.open('u1', OPEN);
    const closed = await s.close('u1', t.id, { outcome: 'assigned', terminalSpot: 190 });
    expect(closed?.outcome).toBe('assigned');
    expect(closed?.realizedPnl100).toBeCloseTo(-600, 6); // (4 − 10) × 100
    expect((await s.list('u1'))[0]!.closedAt).not.toBeNull();
  });

  it('will not close another user\'s trade', async () => {
    const s = new JsonPaperTradeStore(file);
    const t = await s.open('u1', OPEN);
    expect(await s.close('u2', t.id, { outcome: 'expired_otm' })).toBeNull();
  });

  it('feeds the calibration harness', async () => {
    const s = new JsonPaperTradeStore(file);
    for (let i = 0; i < 10; i++) {
      const t = await s.open('u1', { ...OPEN, occSymbol: `X${i}` });
      await s.close('u1', t.id, i < 8 ? { outcome: 'expired_otm' } : { outcome: 'assigned', terminalSpot: 150 });
    }
    const report = calibrationReport(await s.list('u1'));
    expect(report.n).toBe(10);
    expect(report.pop!.realizedWinRate).toBeCloseTo(0.8, 6);
  });
});
