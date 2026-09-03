import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

/**
 * Frozen shareable comparisons (plan §8.5, milestone M4.5).
 *
 * A frozen comparison pins an exact set of contracts to the snapshot they were
 * compared against, so "I compared these five puts on 2026-09-02" stays a
 * reproducible, shareable statement. Anonymous or account-owned.
 */
export interface FrozenComparison {
  id: string;
  /** Auth.js user id, or null for an anonymous freeze. */
  userId: string | null;
  /** The snapshot runId the contracts were pulled from. */
  snapshotRunId: string;
  occSymbols: string[];
  createdAt: string;
}

export interface FrozenComparisonStore {
  create(input: {
    userId: string | null;
    snapshotRunId: string;
    occSymbols: string[];
  }): Promise<FrozenComparison>;
  get(id: string): Promise<FrozenComparison | null>;
}

type FileShape = { comparisons: FrozenComparison[] };

const EMPTY: FileShape = { comparisons: [] };

/** JSON-file store at `<PSS_DATA_DIR or ../../.data>/frozen-comparisons.json`. */
export class JsonFrozenComparisonStore implements FrozenComparisonStore {
  constructor(private readonly file: string) {}

  private async read(): Promise<FileShape> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<FileShape>;
      return { comparisons: raw.comparisons ?? [] };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
      throw e;
    }
  }

  private async write(data: FileShape): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  async create(input: {
    userId: string | null;
    snapshotRunId: string;
    occSymbols: string[];
  }): Promise<FrozenComparison> {
    const data = await this.read();
    const comparison: FrozenComparison = {
      id: randomUUID(),
      userId: input.userId,
      snapshotRunId: input.snapshotRunId,
      occSymbols: [...new Set(input.occSymbols.map((s) => s.trim()).filter(Boolean))],
      createdAt: new Date().toISOString(),
    };
    data.comparisons.push(comparison);
    await this.write(data);
    return comparison;
  }

  async get(id: string): Promise<FrozenComparison | null> {
    return (await this.read()).comparisons.find((c) => c.id === id) ?? null;
  }
}

let cached: FrozenComparisonStore | null = null;

export function getFrozenStore(): FrozenComparisonStore {
  if (cached) return cached;
  const base = process.env.PSS_DATA_DIR ?? join(process.cwd(), '..', '..', '.data');
  cached = new JsonFrozenComparisonStore(join(base, 'frozen-comparisons.json'));
  return cached;
}
