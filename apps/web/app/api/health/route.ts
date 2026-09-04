import { NextResponse } from 'next/server';
import { getStore } from '@/app/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Operational health check (plan §10.7). Stands in for the two §10.7 alerts
 * that aren't computable from a single ingestion run's own fields — "two
 * consecutive scheduled runs missed" (a scheduled run lands roughly every
 * 2h45m per the 10:00/12:30/15:15 schedule; > 6h stale means at least one was
 * missed) and a cheap signal for overall app health a load balancer or
 * uptime monitor can poll before healthchecks.io / Grafana are provisioned.
 * See docs/runbook.md "On-call" for the full alert → response mapping.
 */

const STALE_AFTER_MS = 6 * 60 * 60_000; // ~2 missed scheduled runs

export async function GET() {
  const warnings: string[] = [];
  let latestSnapshot: {
    runId: string;
    createdAt: string;
    ageMinutes: number;
    status: string;
    dataCompleteness: number;
  } | null = null;

  try {
    const store = await getStore();
    const snap = await store.latest();
    if (!snap) {
      warnings.push('no snapshot found');
    } else {
      const ageMs = Date.now() - Date.parse(snap.meta.createdAt);
      latestSnapshot = {
        runId: snap.meta.runId,
        createdAt: snap.meta.createdAt,
        ageMinutes: Math.round(ageMs / 60_000),
        status: snap.meta.status,
        dataCompleteness: snap.meta.dataCompleteness,
      };
      if (snap.meta.status === 'failed') warnings.push('latest snapshot status is failed');
      if (ageMs > STALE_AFTER_MS) {
        warnings.push(`latest snapshot is ${(ageMs / 3_600_000).toFixed(1)}h old (dead-man's-switch threshold ${STALE_AFTER_MS / 3_600_000}h)`);
      }
    }
  } catch (e) {
    warnings.push(`store unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ok = warnings.length === 0;
  return NextResponse.json(
    {
      ok,
      store: process.env.DATABASE_URL ? 'postgres' : 'json',
      latestSnapshot,
      warnings,
    },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
