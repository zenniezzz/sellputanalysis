/**
 * Frozen side-by-side comparisons (plan §8.4, milestone M4.5).
 * A pinned set of contracts from one snapshot, shareable by id.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export interface FrozenComparison {
  id: string;
  userId: string | null;
  snapshotRunId: string;
  occSymbols: string[];
  createdAt: string;
}

export interface FrozenComparisonInput {
  userId?: string | null;
  snapshotRunId: string;
  occSymbols: string[];
}

export interface FrozenComparisonStore {
  create(input: FrozenComparisonInput): Promise<FrozenComparison>;
  get(id: string): Promise<FrozenComparison | null>;
}

function normSymbols(occSymbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of occSymbols) {
    const s = raw.trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

export class JsonFrozenComparisonStore implements FrozenComparisonStore {
  constructor(private readonly file: string) {}

  private async read(): Promise<FrozenComparison[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as FrozenComparison[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async create(input: FrozenComparisonInput): Promise<FrozenComparison> {
    const all = await this.read();
    const created: FrozenComparison = {
      id: randomUUID(),
      userId: input.userId ?? null,
      snapshotRunId: input.snapshotRunId,
      occSymbols: normSymbols(input.occSymbols),
      createdAt: new Date().toISOString(),
    };
    all.push(created);
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(all, null, 2)}\n`);
    return created;
  }

  async get(id: string): Promise<FrozenComparison | null> {
    return (await this.read()).find((c) => c.id === id) ?? null;
  }
}
