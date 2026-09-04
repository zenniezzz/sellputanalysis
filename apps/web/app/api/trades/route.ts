import { NextResponse } from 'next/server';
import type { OpenTradeInput } from '@pss/store';
import { currentUserId } from '@/app/lib/session';
import { getPaperTradeStore } from '@/app/lib/trades';
import { finiteNumber } from '@/app/lib/validate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ trades: [] });
  return NextResponse.json({ trades: await (await getPaperTradeStore()).list(uid) });
}

export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Partial<OpenTradeInput>;
  const strike = finiteNumber(b.strike, { min: 0 });
  const entryCredit = finiteNumber(b.entryCredit, { min: 0 });
  const entrySpot = finiteNumber(b.entrySpot, { min: 0 });
  const breakeven = finiteNumber(b.breakeven, { min: 0 });
  const dteAtEntry = finiteNumber(b.dteAtEntry, { min: 0 });
  if (
    !b.occSymbol ||
    !b.symbol ||
    !b.expiration ||
    strike == null ||
    entryCredit == null ||
    entrySpot == null ||
    breakeven == null ||
    dteAtEntry == null ||
    !b.snapshotRunId
  ) {
    return NextResponse.json({ error: 'missing or invalid fields' }, { status: 400 });
  }
  const trade = await (await getPaperTradeStore()).open(uid, {
    ...b,
    strike,
    entryCredit,
    entrySpot,
    breakeven,
    dteAtEntry,
  } as OpenTradeInput);
  return NextResponse.json({ trade }, { status: 201 });
}
