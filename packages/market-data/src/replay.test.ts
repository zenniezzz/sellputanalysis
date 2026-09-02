import { describe, expect, it, vi } from 'vitest';
import { CboeAdapter } from './cboe/adapter.js';
import {
  InMemoryPayloadStore,
  RecordingMarketData,
  ReplayMarketData,
} from './replay.js';

const FIXTURE = {
  timestamp: '2026-09-02T14:00:00Z',
  data: {
    symbol: 'AAPL',
    current_price: 227.5,
    options: [
      { option: 'AAPL261016P00210000', bid: 3.1, ask: 3.3, volume: 10, open_interest: 20, iv: 0.27, delta: -0.28 },
    ],
  },
};

function fakeFetch(payload: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
}

describe('record → replay round-trip', () => {
  it('replays identical results without touching the network', async () => {
    const f = fakeFetch(FIXTURE);
    const live = new CboeAdapter({ fetchImpl: f });
    const sink = new InMemoryPayloadStore();
    const recording = new RecordingMarketData(live, sink, () => '2026-09-02T14:00:01Z');

    const u1 = await recording.getUnderlying('AAPL');
    const e1 = await recording.getExpirations('AAPL');
    const c1 = await recording.getChain('AAPL', '2026-10-16');
    const callsAfterRecord = (f as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    const replay = new ReplayMarketData(sink.entries);
    const u2 = await replay.getUnderlying('AAPL');
    const e2 = await replay.getExpirations('AAPL');
    const c2 = await replay.getChain('AAPL', '2026-10-16');

    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(callsAfterRecord);
    expect(u2).toEqual(u1);
    expect(e2).toEqual(e1);
    expect(c2).toEqual(c1);
  });

  it('returns not_found for a symbol that was never recorded', async () => {
    const replay = new ReplayMarketData([]);
    const r = await replay.getUnderlying('ZZZZ');
    expect(r.ok).toBe(false);
  });
});
