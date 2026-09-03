import { NextResponse } from 'next/server';
import { currentUserId } from '@/app/lib/session';
import { getUserDataStore } from '@/app/lib/stores';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ symbols: [] });
  return NextResponse.json({ symbols: await getUserDataStore().getWatchlist(uid) });
}

export async function PUT(req: Request) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const body = (await req.json()) as { symbols?: string[] };
  const symbols = await getUserDataStore().setWatchlist(uid, body.symbols ?? []);
  return NextResponse.json({ symbols });
}

export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const body = (await req.json()) as { symbol?: string };
  if (!body.symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  const symbols = await getUserDataStore().toggleWatch(uid, body.symbol);
  return NextResponse.json({ symbols });
}
