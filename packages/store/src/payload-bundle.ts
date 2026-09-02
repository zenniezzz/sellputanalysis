/**
 * Raw provider-response bundle for replay (plan §4.5).
 * M1: one JSON file per run; the per-kind files + `raw_payload_manifest` table
 * arrive with the DB work in M2.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PayloadEntry, PayloadSink } from '@pss/market-data';

export interface BundleManifest {
  runId: string;
  asOf: string;
  createdAt: string;
  entryCount: number;
  byKind: Record<string, number>;
}

export class FilePayloadStore implements PayloadSink {
  readonly entries: PayloadEntry[] = [];

  constructor(
    private readonly root: string,
    private readonly runId: string,
    private readonly asOf: string,
  ) {}

  private dir(): string {
    return join(this.root, this.runId);
  }

  record(entry: PayloadEntry): void {
    this.entries.push(entry);
  }

  async flush(): Promise<string> {
    const dir = this.dir();
    await mkdir(dir, { recursive: true });

    const byKind: Record<string, number> = {};
    for (const e of this.entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;

    const manifest: BundleManifest = {
      runId: this.runId,
      asOf: this.asOf,
      createdAt: new Date().toISOString(),
      entryCount: this.entries.length,
      byKind,
    };
    await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(dir, 'entries.json'), `${JSON.stringify(this.entries)}\n`);
    return dir;
  }

  static async load(root: string, runId: string): Promise<PayloadEntry[]> {
    const raw = await readFile(join(root, runId, 'entries.json'), 'utf8');
    return JSON.parse(raw) as PayloadEntry[];
  }

  static async loadManifest(root: string, runId: string): Promise<BundleManifest> {
    return JSON.parse(await readFile(join(root, runId, 'manifest.json'), 'utf8')) as BundleManifest;
  }
}
