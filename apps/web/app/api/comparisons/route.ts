import { NextResponse } from 'next/server';
import { currentUserId } from '@/app/lib/session';
import { getFrozenStore } from '@/app/lib/frozen';
import { resolveSnapshotRunId } from '@/app/lib/compare-rows';

export const dynamic = 'force-dynamic';

/**
 * POST { occSymbols: string[], snapshotRunId?: string }
 *   → { id, url: '/compare/<id>' }
 * Anonymous freezes are allowed (userId is null).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    occSymbols?: unknown;
    snapshotRunId?: unknown;
  };

  const occSymbols = Array.isArray(body.occSymbols)
    ? body.occSymbols.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  if (occSymbols.length === 0) {
    return NextResponse.json({ error: 'occSymbols required' }, { status: 400 });
  }

  const explicit = typeof body.snapshotRunId === 'string' ? body.snapshotRunId : null;
  const snapshotRunId = await resolveSnapshotRunId(explicit);
  if (!snapshotRunId) {
    return NextResponse.json({ error: 'no snapshot to freeze against' }, { status: 404 });
  }

  const userId = await currentUserId();
  const comparison = await getFrozenStore().create({ userId, snapshotRunId, occSymbols });

  return NextResponse.json({ id: comparison.id, url: `/compare/${comparison.id}` }, { status: 201 });
}
