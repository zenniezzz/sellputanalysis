import { NextResponse } from 'next/server';
import { resolveComparison } from '@/app/lib/compare-rows';

export const dynamic = 'force-dynamic';

/** GET → the FrozenComparison + the resolved ScreenedRow[] for its contracts. 404 if unknown. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resolved = await resolveComparison(id);
  if (!resolved) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({
    comparison: resolved.frozen,
    snapshot: { meta: resolved.meta, run: resolved.run },
    rows: resolved.rows,
    missing: resolved.missing,
  });
}
