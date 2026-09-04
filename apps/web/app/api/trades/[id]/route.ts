import { NextResponse } from 'next/server';
import type { CloseTradeInput } from '@pss/store';
import { currentUserId } from '@/app/lib/session';
import { getPaperTradeStore } from '@/app/lib/trades';
import { finiteNumber } from '@/app/lib/validate';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });

  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Partial<CloseTradeInput>;
  if (!b.outcome || !['expired_otm', 'assigned', 'closed_early', 'rolled'].includes(b.outcome)) {
    return NextResponse.json({ error: 'valid outcome required' }, { status: 400 });
  }
  // optional numeric fields: drop anything non-finite rather than persist NaN/Infinity
  // (calibrationReport divides by these — a bad value corrupts every user's report render)
  const terminalSpot = finiteNumber(b.terminalSpot, { min: 0 });
  const exitCredit = finiteNumber(b.exitCredit, { min: 0 });
  const close: CloseTradeInput = {
    outcome: b.outcome,
    terminalSpot: b.terminalSpot == null ? null : terminalSpot,
    exitCredit: b.exitCredit == null ? null : exitCredit,
    notes: typeof b.notes === 'string' ? b.notes.slice(0, 2000) : null,
  };
  const trade = await (await getPaperTradeStore()).close(uid, id, close);
  return trade ? NextResponse.json({ trade }) : NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const { id } = await params;
  await (await getPaperTradeStore()).delete(uid, id);
  return NextResponse.json({ ok: true });
}
