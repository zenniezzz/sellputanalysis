/**
 * Paper-trade log (plan §13.1, milestone M6.5). Keyed by the Auth.js user id.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { applyClose, type CloseTradeInput, type OpenTradeInput, type PaperTrade } from '@pss/tracker';

export type { PaperTrade, OpenTradeInput, CloseTradeInput } from '@pss/tracker';

export interface PaperTradeStore {
  list(userId: string | null): Promise<PaperTrade[]>;
  open(userId: string | null, input: OpenTradeInput): Promise<PaperTrade>;
  close(userId: string | null, id: string, input: CloseTradeInput): Promise<PaperTrade | null>;
  delete(userId: string | null, id: string): Promise<void>;
  get(id: string): Promise<PaperTrade | null>;
}

export function newPaperTrade(userId: string | null, input: OpenTradeInput): PaperTrade {
  return {
    id: randomUUID(),
    userId,
    createdAt: new Date().toISOString(),
    snapshotRunId: input.snapshotRunId,
    occSymbol: input.occSymbol,
    symbol: input.symbol,
    expiration: input.expiration,
    strike: input.strike,
    multiplier: input.multiplier ?? 100,
    contracts: Math.max(1, Math.round(input.contracts ?? 1)),
    entryCredit: input.entryCredit,
    actualFillCredit: input.actualFillCredit ?? null,
    entrySpot: input.entrySpot,
    breakeven: input.breakeven,
    modeledPop: input.modeledPop ?? null,
    modeledProbItm: input.modeledProbItm ?? null,
    modeledEv100: input.modeledEv100 ?? null,
    sigmaF: input.sigmaF ?? null,
    delta: input.delta ?? null,
    dteAtEntry: input.dteAtEntry,
    closedAt: null,
    outcome: null,
    terminalSpot: null,
    exitCredit: null,
    realizedPnl100: null,
    notes: input.notes ?? null,
  };
}

export class JsonPaperTradeStore implements PaperTradeStore {
  constructor(private readonly file: string) {}

  private async read(): Promise<PaperTrade[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as PaperTrade[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  private async write(all: PaperTrade[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(all, null, 2)}\n`);
  }

  async list(userId: string | null): Promise<PaperTrade[]> {
    return (await this.read())
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async open(userId: string | null, input: OpenTradeInput): Promise<PaperTrade> {
    const all = await this.read();
    const t = newPaperTrade(userId, input);
    all.push(t);
    await this.write(all);
    return t;
  }

  async close(userId: string | null, id: string, input: CloseTradeInput): Promise<PaperTrade | null> {
    const all = await this.read();
    const idx = all.findIndex((t) => t.id === id && t.userId === userId);
    if (idx < 0) return null;
    all[idx] = applyClose(all[idx]!, input, new Date().toISOString());
    await this.write(all);
    return all[idx]!;
  }

  async delete(userId: string | null, id: string): Promise<void> {
    const all = await this.read();
    await this.write(all.filter((t) => !(t.id === id && t.userId === userId)));
  }

  async get(id: string): Promise<PaperTrade | null> {
    return (await this.read()).find((t) => t.id === id) ?? null;
  }
}
