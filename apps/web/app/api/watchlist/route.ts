import { NextResponse } from 'next/server';
import { currentUserId } from '@/app/lib/session';
import { getUserDataStore } from '@/app/lib/stores';
import { cleanSymbol, cleanSymbols } from '@/app/lib/validate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ symbols: [] });
  return NextResponse.json({ symbols: await (await getUserDataStore()).getWatchlist(uid) });
}

export async function PUT(req: Request) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { symbols?: unknown };
  const symbols = cleanSymbols(body.symbols ?? []);
  if (!symbols) return NextResponse.json({ error: 'invalid symbols' }, { status: 400 });
  return NextResponse.json({ symbols: await (await getUserDataStore()).setWatchlist(uid, symbols) });
}

export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { symbol?: unknown };
  const symbol = cleanSymbol(body.symbol);
  if (!symbol) return NextResponse.json({ error: 'valid symbol required' }, { status: 400 });
  const symbols = await (await getUserDataStore()).toggleWatch(uid, symbol);
  return NextResponse.json({ symbols });
}
