import { describe, expect, it, vi } from 'vitest';
import { CboeAdapter } from './adapter.js';

const FIXTURE = {
  timestamp: '2026-09-02T14:00:00Z',
  data: {
    symbol: 'AAPL',
    current_price: 227.5,
    close: 226.9,
    price_change_percent: 0.83,
    options: [
      { option: 'AAPL261016P00210000', bid: 3.1, ask: 3.3, bid_size: 40, ask_size: 55, last_trade_price: 3.2, volume: 1200, open_interest: 8400, iv: 0.271, delta: -0.28, gamma: 0.012, theta: -0.06, vega: 0.19 },
      { option: 'AAPL261016P00200000', bid: 1.8, ask: 1.95, bid_size: 12, ask_size: 20, last_trade_price: 1.9, volume: 640, open_interest: 5100, iv: 0.30, delta: -0.19, gamma: 0.010, theta: -0.05, vega: 0.16 },
      { option: 'AAPL261016C00230000', bid: 6.0, ask: 6.2, volume: 900, open_interest: 3000, iv: 0.24, delta: 0.47 },
      { option: 'AAPL261120P00205000', bid: 3.9, ask: 4.15, volume: 210, open_interest: 1500, iv: 0.29, delta: -0.24 },
    ],
  },
};

function fakeFetch(payload: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

describe('CboeAdapter', () => {
  it('getUnderlying returns spot and physical settlement for an equity', async () => {
    const a = new CboeAdapter({ fetchImpl: fakeFetch(FIXTURE) });
    const r = await a.getUnderlying('AAPL');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.spot).toBe(227.5);
      expect(r.value.settlement).toBe('physical');
      expect(r.value.hv20).toBeNull();
      expect(r.value.dailyChangePct).toBe(0.83);
    }
  });

  it('getUnderlying falls back to null dailyChangePct when the provider omits it', async () => {
    const { price_change_percent, ...dataWithoutChange } = FIXTURE.data;
    const a = new CboeAdapter({ fetchImpl: fakeFetch({ ...FIXTURE, data: dataWithoutChange }) });
    const r = await a.getUnderlying('AAPL');
    expect(r.ok && r.value.dailyChangePct).toBeNull();
  });

  it('getExpirations lists distinct sorted dates', async () => {
    const a = new CboeAdapter({ fetchImpl: fakeFetch(FIXTURE) });
    const r = await a.getExpirations('AAPL');
    expect(r.ok && r.value).toEqual(['2026-10-16', '2026-11-20']);
  });

  it('getChain slices one expiration and maps quotes', async () => {
    const a = new CboeAdapter({ fetchImpl: fakeFetch(FIXTURE) });
    const r = await a.getChain('AAPL', '2026-10-16');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(3);
      const p210 = r.value.find((o) => o.strike === 210 && o.right === 'P')!;
      expect(p210.occSymbol).toBe('AAPL  261016P00210000');
      expect(p210.bid).toBe(3.1);
      expect(p210.underlyingPriceAtQuote).toBe(227.5);
      expect(p210.vendorGreeks?.iv).toBe(0.271);
    }
  });

  it('caches within the TTL (one network call for two reads)', async () => {
    const f = fakeFetch(FIXTURE);
    const a = new CboeAdapter({ fetchImpl: f, cacheTtlMs: 10_000, now: () => 1000 });
    await a.getUnderlying('AAPL');
    await a.getChain('AAPL', '2026-10-16');
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('maps HTTP 404 to not_found and 503 to upstream_5xx', async () => {
    const a404 = new CboeAdapter({ fetchImpl: fakeFetch({}, 404) });
    expect((await a404.getUnderlying('ZZZZ')).ok).toBe(false);
    const r404 = await a404.getUnderlying('ZZZZ');
    if (!r404.ok) expect(r404.error.kind).toBe('not_found');

    const a503 = new CboeAdapter({ fetchImpl: fakeFetch({}, 503) });
    const r503 = await a503.getUnderlying('AAPL');
    if (!r503.ok) expect(r503.error.kind).toBe('upstream_5xx');
  });

  it('flags an index as cash-settled European and still returns its chain', async () => {
    const idx = {
      timestamp: '2026-09-02T14:00:00Z',
      data: {
        symbol: '^SPX', // CBOE prefixes indices with a caret
        current_price: 5600,
        options: [
          { option: 'SPXW261016P05400000', bid: 40, ask: 42, iv: 0.18, delta: -0.3, volume: 100, open_interest: 500 },
          { option: 'AAPL1261016P00100000', bid: 1, ask: 1.1, iv: 0.3, delta: -0.2 }, // adjusted deliverable
        ],
      },
    };
    const a = new CboeAdapter({ fetchImpl: fakeFetch(idx) });
    const u = await a.getUnderlying('SPX');
    if (u.ok) {
      expect(u.value.symbol).toBe('SPX');
      expect(u.value.settlement).toBe('cash');
      expect(u.value.exerciseStyle).toBe('european');
    }
    const chain = await a.getChain('SPX', '2026-10-16');
    expect(chain.ok).toBe(true);
    if (chain.ok) {
      const spxw = chain.value.find((o) => o.strike === 5400)!;
      expect(spxw.underlying).toBe('SPX');
      expect(spxw.isNonStandard).toBe(false); // SPXW is a standard weekly root
      const adjusted = chain.value.find((o) => o.strike === 100)!;
      expect(adjusted.isNonStandard).toBe(true); // trailing digit on the root
    }
  });
});
