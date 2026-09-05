/**
 * CBOE delayed-quotes adapter — the free prototype / fallback provider (plan §3.2).
 *
 * Endpoint: https://cdn.cboe.com/api/global/delayed_quotes/options/{SYMBOL}.json
 * Indices are prefixed with an underscore (e.g. `_SPX`). One request returns the
 * whole option chain plus the underlying's current price; we cache it briefly and
 * slice per expiration.
 *
 * Not provided by this feed (returned as null / empty, to be filled by other
 * sources per the plan): dividend schedule, HV, borrow rate, earnings,
 * most-active list.
 */

import { parseOptionSymbol, toOccSymbol } from '../osi.js';
import {
  err,
  ok,
  type EarningsInfo,
  type Iso8601,
  type MarketData,
  type OptionQuote,
  type Result,
  type Underlying,
} from '../types.js';

const BASE = 'https://cdn.cboe.com/api/global/delayed_quotes/options';

const INDEX_SYMBOLS = new Set(['SPX', 'SPXW', 'RUT', 'RUTW', 'NDX', 'XSP', 'DJX', 'OEX', 'VIX']);

interface CboeRawOption {
  option: string;
  bid: number;
  ask: number;
  bid_size?: number;
  ask_size?: number;
  last_trade_price?: number | null;
  volume?: number;
  open_interest?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

interface CboePayload {
  timestamp?: string;
  data?: {
    symbol: string;
    current_price?: number;
    close?: number;
    /** CBOE's own day-over-day % change, already in percent units (0.83 = +0.83%) — not derived from current_price/prev_day_close, which can disagree slightly on a delayed/off-hours feed. */
    price_change_percent?: number;
    options?: CboeRawOption[];
  };
}

/** Validated payload — every field the adapter relies on is present. */
interface LoadedPayload {
  timestamp: string;
  data: {
    symbol: string;
    current_price: number;
    close: number;
    priceChangePercent: number | null;
    options: CboeRawOption[];
  };
}

export interface CboeAdapterOptions {
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  now?: () => number;
}

export class CboeAdapter implements MarketData {
  private readonly cache = new Map<string, { at: number; payload: LoadedPayload }>();
  private readonly fetchImpl: typeof fetch;
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(opts: CboeAdapterOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.ttl = opts.cacheTtlMs ?? 90_000;
    this.now = opts.now ?? (() => Date.now());
  }

  private feedSymbol(symbol: string): string {
    const s = symbol.toUpperCase();
    return INDEX_SYMBOLS.has(s) ? `_${s}` : s;
  }

  private isIndex(symbol: string): boolean {
    return INDEX_SYMBOLS.has(symbol.toUpperCase());
  }

  private async load(symbol: string): Promise<Result<LoadedPayload>> {
    const key = symbol.toUpperCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttl) return ok(hit.payload);

    const url = `${BASE}/${this.feedSymbol(symbol)}.json`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    } catch {
      return err({ kind: 'timeout' });
    }

    if (res.status === 404) return err({ kind: 'not_found' });
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') ?? '2');
      return err({ kind: 'rate_limited', retryAfterMs: Number.isFinite(ra) ? ra * 1000 : 2000 });
    }
    if (res.status >= 500) return err({ kind: 'upstream_5xx', status: res.status });
    if (!res.ok) return err({ kind: 'malformed', detail: `HTTP ${res.status}` });

    let raw: CboePayload;
    try {
      raw = (await res.json()) as CboePayload;
    } catch {
      return err({ kind: 'malformed', detail: 'invalid JSON' });
    }
    const d = raw.data;
    if (!d || !d.options || d.current_price == null) {
      return err({ kind: 'malformed', detail: 'missing data.options / current_price' });
    }

    const payload: LoadedPayload = {
      timestamp: raw.timestamp ?? new Date(this.now()).toISOString(),
      data: {
        symbol: d.symbol,
        current_price: d.current_price,
        close: d.close ?? d.current_price,
        priceChangePercent: d.price_change_percent ?? null,
        options: d.options,
      },
    };
    this.cache.set(key, { at: this.now(), payload });
    return ok(payload);
  }

  async getUnderlying(symbol: string): Promise<Result<Underlying>> {
    const r = await this.load(symbol);
    if (!r.ok) return r;
    const d = r.value.data;
    const idx = this.isIndex(symbol);
    const clean = d.symbol.replace(/^[\^_]/, '');
    return ok({
      symbol: clean,
      name: clean,
      spot: d.current_price,
      spotAsOf: r.value.timestamp,
      dailyChangePct: d.priceChangePercent,
      dividends: [],
      hv20: null,
      hv252: null,
      borrowRate: null,
      hardToBorrow: false,
      optionVolume20dAvg: null,
      hasWeeklies: true,
      isAdr: false,
      sector: null,
      settlement: idx ? 'cash' : 'physical',
      exerciseStyle: idx ? 'european' : 'american',
      settlementTime: idx ? 'pm' : null,
    });
  }

  async getExpirations(symbol: string): Promise<Result<Iso8601[]>> {
    const r = await this.load(symbol);
    if (!r.ok) return r;
    const set = new Set<string>();
    for (const o of r.value.data.options) {
      try {
        set.add(parseOptionSymbol(o.option).expiration);
      } catch {
        /* skip unparseable rows */
      }
    }
    return ok([...set].sort());
  }

  async getChain(symbol: string, expiration: Iso8601): Promise<Result<OptionQuote[]>> {
    const r = await this.load(symbol);
    if (!r.ok) return r;
    const d = r.value.data;
    const asOf = r.value.timestamp;
    const out: OptionQuote[] = [];

    for (const o of d.options) {
      let parsed;
      try {
        parsed = parseOptionSymbol(o.option);
      } catch {
        continue;
      }
      if (parsed.expiration !== expiration) continue;

      const vendorGreeks =
        o.iv != null && o.delta != null
          ? {
              delta: o.delta,
              gamma: o.gamma ?? NaN,
              theta: o.theta ?? NaN,
              vega: o.vega ?? NaN,
              iv: o.iv,
            }
          : undefined;

      out.push({
        occSymbol: toOccSymbol(parsed),
        underlying: d.symbol.replace(/^[\^_]/, ''),
        expiration: parsed.expiration,
        strike: parsed.strike,
        right: parsed.right,
        multiplier: 100,
        bid: o.bid,
        ask: o.ask,
        bidSize: o.bid_size ?? 0,
        askSize: o.ask_size ?? 0,
        last: o.last_trade_price ?? null,
        volume: o.volume ?? 0,
        openInterest: o.open_interest ?? 0,
        quoteAsOf: asOf,
        underlyingPriceAtQuote: d.current_price,
        underlyingPriceAsOf: asOf,
        // Adjusted-deliverable options carry a trailing digit on the root
        // (e.g. "AAPL1"). Standard weeklies ("SPXW", "RUTW") are not adjusted.
        isNonStandard: /\d$/.test(parsed.root),
        ...(vendorGreeks ? { vendorGreeks } : {}),
      });
    }

    if (out.length === 0) return err({ kind: 'not_found' });
    return ok(out);
  }

  async getMostActive(): Promise<Result<Underlying[]>> {
    return err({
      kind: 'malformed',
      detail: 'CboeAdapter.getMostActive: use the OCC daily volume file (plan §3.1)',
    });
  }

  async getEarnings(): Promise<Result<EarningsInfo | null>> {
    return ok(null);
  }
}
