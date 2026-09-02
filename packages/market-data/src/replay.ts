/**
 * Recording / replay wrappers for point-in-time reproducibility (plan §4.5).
 *
 * `RecordingMarketData` transparently captures every provider response so a run
 * can be re-executed later from the captured bundle. `ReplayMarketData` serves
 * those captures back. Both satisfy `MarketData`, so the pipeline is unaware.
 */

import type {
  EarningsInfo,
  Iso8601,
  MarketData,
  OptionQuote,
  RatesSource,
  Result,
  Underlying,
  ZeroRatePoint,
} from './types.js';
import { err, ok } from './types.js';

export type PayloadKind =
  | 'most_active'
  | 'expirations'
  | 'chain'
  | 'underlying'
  | 'earnings'
  | 'rates';

export interface PayloadEntry {
  kind: PayloadKind;
  /** '' for run-level payloads (most_active, rates). */
  symbol: string;
  /** Extra key component, e.g. the expiration for a chain. */
  arg?: string;
  /** The `Result<T>` as returned by the underlying provider. */
  result: Result<unknown>;
  capturedAt: Iso8601;
}

export interface PayloadSink {
  record(entry: PayloadEntry): void;
}

export class InMemoryPayloadStore implements PayloadSink {
  readonly entries: PayloadEntry[] = [];
  record(entry: PayloadEntry): void {
    this.entries.push(entry);
  }
  key(kind: PayloadKind, symbol: string, arg?: string): string {
    return `${kind}::${symbol}::${arg ?? ''}`;
  }
  find(kind: PayloadKind, symbol: string, arg?: string): PayloadEntry | undefined {
    const k = this.key(kind, symbol, arg);
    return this.entries.find((e) => this.key(e.kind, e.symbol, e.arg) === k);
  }
}

export class RecordingMarketData implements MarketData {
  constructor(
    private readonly inner: MarketData,
    private readonly sink: PayloadSink,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private async capture<T>(
    kind: PayloadKind,
    symbol: string,
    arg: string | undefined,
    call: () => Promise<Result<T>>,
  ): Promise<Result<T>> {
    const result = await call();
    this.sink.record({ kind, symbol, arg, result, capturedAt: this.now() });
    return result;
  }

  getMostActive(limit: number) {
    return this.capture('most_active', '', String(limit), () => this.inner.getMostActive(limit));
  }
  getExpirations(symbol: string) {
    return this.capture('expirations', symbol, undefined, () => this.inner.getExpirations(symbol));
  }
  getChain(symbol: string, expiration: Iso8601) {
    return this.capture('chain', symbol, expiration, () => this.inner.getChain(symbol, expiration));
  }
  getUnderlying(symbol: string) {
    return this.capture('underlying', symbol, undefined, () => this.inner.getUnderlying(symbol));
  }
  getEarnings(symbol: string) {
    return this.capture('earnings', symbol, undefined, () => this.inner.getEarnings(symbol));
  }
}

/** Wraps a RatesSource so the curve lands in the same bundle. */
export class RecordingRatesSource implements RatesSource {
  constructor(
    private readonly inner: RatesSource,
    private readonly sink: PayloadSink,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  async getCurve(asOf: Iso8601): Promise<Result<ZeroRatePoint[]>> {
    const result = await this.inner.getCurve(asOf);
    this.sink.record({ kind: 'rates', symbol: '', arg: asOf, result, capturedAt: this.now() });
    return result;
  }
}

const MISSING = err({ kind: 'not_found' as const });

export class ReplayMarketData implements MarketData {
  private readonly store: InMemoryPayloadStore;

  constructor(entries: PayloadEntry[]) {
    this.store = new InMemoryPayloadStore();
    for (const e of entries) this.store.record(e);
  }

  private lookup<T>(kind: PayloadKind, symbol: string, arg?: string): Result<T> {
    const hit = this.store.find(kind, symbol, arg);
    return hit ? (hit.result as Result<T>) : (MISSING as Result<T>);
  }

  async getMostActive(limit: number): Promise<Result<Underlying[]>> {
    return this.lookup('most_active', '', String(limit));
  }
  async getExpirations(symbol: string): Promise<Result<Iso8601[]>> {
    return this.lookup('expirations', symbol);
  }
  async getChain(symbol: string, expiration: Iso8601): Promise<Result<OptionQuote[]>> {
    return this.lookup('chain', symbol, expiration);
  }
  async getUnderlying(symbol: string): Promise<Result<Underlying>> {
    return this.lookup('underlying', symbol);
  }
  async getEarnings(symbol: string): Promise<Result<EarningsInfo | null>> {
    return this.lookup('earnings', symbol);
  }
}

export class ReplayRatesSource implements RatesSource {
  private readonly store: InMemoryPayloadStore;
  constructor(entries: PayloadEntry[]) {
    this.store = new InMemoryPayloadStore();
    for (const e of entries) this.store.record(e);
  }
  async getCurve(asOf: Iso8601): Promise<Result<ZeroRatePoint[]>> {
    const hit = this.store.find('rates', '', asOf) ?? this.store.entries.find((e) => e.kind === 'rates');
    return hit ? (hit.result as Result<ZeroRatePoint[]>) : ok([]);
  }
}
