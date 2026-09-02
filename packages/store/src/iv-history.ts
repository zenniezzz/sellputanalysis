/**
 * 30-day ATM implied-vol history (plan §3.1, §11, milestone M1.5).
 *
 * One sample per underlying per trading day. Accrued from every scheduled run so
 * that IV rank / percentile (M2) has real inputs; the ORATS 1-year backfill
 * (M2) imports into the same store with `source = 'orats_backfill'`.
 *
 * Stored values are AS COMPUTED on `date` and never recomputed as the trailing
 * window rolls (plan §9.1).
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IvSample } from '@pss/pipeline';

export type { IvSample, IvSampleSource } from '@pss/pipeline';

export interface IvHistoryStore {
  /** Idempotent on (symbol, date): a later sample for the same day replaces the earlier one. */
  append(samples: IvSample[]): Promise<void>;
  /** Ascending by date. `sinceDays` trims to roughly that many calendar days back. */
  history(symbol: string, sinceDays?: number): Promise<IvSample[]>;
  latestDate(symbol: string): Promise<string | null>;
  symbols(): Promise<string[]>;
}

function dedupeByDate(samples: IvSample[]): IvSample[] {
  const byDate = new Map<string, IvSample>();
  for (const s of samples) byDate.set(s.date, s);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export class JsonIvHistoryStore implements IvHistoryStore {
  constructor(private readonly root: string) {}

  private file(symbol: string): string {
    return join(this.root, `${symbol.toUpperCase()}.json`);
  }

  private async read(symbol: string): Promise<IvSample[]> {
    try {
      return JSON.parse(await readFile(this.file(symbol), 'utf8')) as IvSample[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async append(samples: IvSample[]): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const bySymbol = new Map<string, IvSample[]>();
    for (const s of samples) {
      const arr = bySymbol.get(s.symbol) ?? [];
      arr.push(s);
      bySymbol.set(s.symbol, arr);
    }
    for (const [symbol, incoming] of bySymbol) {
      const merged = dedupeByDate([...(await this.read(symbol)), ...incoming]);
      await writeFile(this.file(symbol), `${JSON.stringify(merged, null, 2)}\n`);
    }
  }

  async history(symbol: string, sinceDays?: number): Promise<IvSample[]> {
    const all = dedupeByDate(await this.read(symbol));
    if (sinceDays == null) return all;
    const cutoff = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
    return all.filter((s) => s.date >= cutoff);
  }

  async latestDate(symbol: string): Promise<string | null> {
    const all = await this.read(symbol);
    return all.length ? dedupeByDate(all).at(-1)!.date : null;
  }

  async symbols(): Promise<string[]> {
    try {
      return (await readdir(this.root))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }
}
