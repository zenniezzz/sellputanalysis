import { NextResponse } from 'next/server';
import type { CloseTradeInput } from '@pss/store';
import { currentUserId } from '@/app/lib/session';
import { getPaperTradeStore } from '@/app/lib/trades';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Partial<CloseTradeInput>;
  if (!b.outcome || !['expired_otm', 'assigned', 'closed_early', 'rolled'].includes(b.outcome)) {
    return NextResponse.json({ error: 'valid outcome required' }, { status: 400 });
  }
  const trade = await getPaperTradeStore().close(uid, params.id, b as CloseTradeInput);
  return trade ? NextResponse.json({ trade }) : NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  await getPaperTradeStore().delete(uid, params.id);
  return NextResponse.json({ ok: true });
}
