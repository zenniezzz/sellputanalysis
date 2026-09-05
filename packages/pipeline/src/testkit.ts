/** Synthetic MarketData for pipeline tests — a BSM-consistent chain generator. */

import { bsmGreeks, bsmPrice } from '@pss/options';
import type {
  EarningsInfo,
  Iso8601,
  MarketData,
  OptionQuote,
  Result,
  Underlying,
} from '@pss/market-data';
import { ok, err, toOccSymbol } from '@pss/market-data';

export interface MockNameSpec {
  symbol: string;
  spot: number;
  iv: number;
  settlement?: 'physical' | 'cash';
  hv20?: number | null;
  hv252?: number | null;
  dailyChangePct?: number | null;
  /** Force this name's chain fetch to fail (to exercise degraded snapshots). */
  fail?: boolean;
}

export interface MockMarketDataOptions {
  now: Date;
  /** Expiration offsets in calendar days from `now`. */
  dteOffsets?: number[];
  rate?: number;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class MockMarketData implements MarketData {
  private readonly byExpiration: string[];
  constructor(
    private readonly names: MockNameSpec[],
    private readonly opts: MockMarketDataOptions,
  ) {
    const offsets = opts.dteOffsets ?? [16, 30, 37, 51];
    this.byExpiration = offsets.map((d) => isoDate(opts.now.getTime() + d * 86_400_000));
  }

  private spec(symbol: string): MockNameSpec | undefined {
    return this.names.find((n) => n.symbol === symbol);
  }

  async getMostActive(): Promise<Result<Underlying[]>> {
    return err({ kind: 'malformed', detail: 'mock: not implemented' });
  }

  async getUnderlying(symbol: string): Promise<Result<Underlying>> {
    const s = this.spec(symbol);
    if (!s) return err({ kind: 'not_found' });
    const isCash = s.settlement === 'cash';
    return ok({
      symbol,
      name: symbol,
      spot: s.spot,
      spotAsOf: this.opts.now.toISOString(),
      dailyChangePct: s.dailyChangePct ?? null,
      dividends: [],
      hv20: s.hv20 ?? 0.28,
      hv252: s.hv252 ?? 0.3,
      borrowRate: null,
      hardToBorrow: false,
      optionVolume20dAvg: 50_000,
      hasWeeklies: true,
      isAdr: false,
      sector: null,
      settlement: isCash ? 'cash' : 'physical',
      exerciseStyle: isCash ? 'european' : 'american',
      settlementTime: isCash ? 'pm' : null,
    });
  }

  async getExpirations(symbol: string): Promise<Result<Iso8601[]>> {
    if (!this.spec(symbol)) return err({ kind: 'not_found' });
    return ok([...this.byExpiration]);
  }

  async getChain(symbol: string, expiration: Iso8601): Promise<Result<OptionQuote[]>> {
    const s = this.spec(symbol);
    if (!s) return err({ kind: 'not_found' });
    if (s.fail) return err({ kind: 'upstream_5xx', status: 502 });

    const expMs = new Date(`${expiration}T20:00:00Z`).getTime();
    const t = Math.max((expMs - this.opts.now.getTime()) / (365 * 86_400_000), 1 / 365);
    const r = this.opts.rate ?? 0.043;

    const quotes: OptionQuote[] = [];
    for (let mult = 0.7; mult <= 1.1 + 1e-9; mult += 0.025) {
      const strike = Math.round(s.spot * mult);
      for (const right of ['P', 'C'] as const) {
        const mid = bsmPrice({ s: s.spot, k: strike, r, q: 0, sigma: s.iv, t }, right === 'P' ? 'put' : 'call');
        if (mid <= 0.02) continue;
        const half = Math.max(0.02, mid * 0.02);
        const g = bsmGreeks({ s: s.spot, k: strike, r, q: 0, sigma: s.iv, t }, right === 'P' ? 'put' : 'call');
        quotes.push({
          occSymbol: toOccSymbol({ root: symbol, expiration, right, strike }),
          underlying: symbol,
          expiration,
          strike,
          right,
          multiplier: 100,
          bid: Number((mid - half).toFixed(2)),
          ask: Number((mid + half).toFixed(2)),
          bidSize: 25,
          askSize: 25,
          last: Number(mid.toFixed(2)),
          volume: 800,
          openInterest: 4000,
          quoteAsOf: this.opts.now.toISOString(),
          underlyingPriceAtQuote: s.spot,
          underlyingPriceAsOf: this.opts.now.toISOString(),
          isNonStandard: false,
          vendorGreeks: { delta: g.delta, gamma: g.gamma, theta: g.thetaPerDay, vega: g.vega, iv: s.iv },
        });
      }
    }
    return ok(quotes);
  }

  async getEarnings(): Promise<Result<EarningsInfo | null>> {
    return ok(null);
  }
}
