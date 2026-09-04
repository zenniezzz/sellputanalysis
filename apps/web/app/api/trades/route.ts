import { NextResponse } from 'next/server';
import type { OpenTradeInput } from '@pss/store';
import { currentUserId } from '@/app/lib/session';
import { getPaperTradeStore } from '@/app/lib/trades';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ trades: [] });
  return NextResponse.json({ trades: await getPaperTradeStore().list(uid) });
}

export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Partial<OpenTradeInput>;
  if (!b.occSymbol || !b.symbol || !b.expiration || b.strike == null || b.entryCredit == null || b.entrySpot == null || b.breakeven == null || b.dteAtEntry == null || !b.snapshotRunId) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }
  const trade = await getPaperTradeStore().open(uid, b as OpenTradeInput);
  return NextResponse.json({ trade }, { status: 201 });
}
