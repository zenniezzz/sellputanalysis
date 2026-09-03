import { NextResponse } from 'next/server';
import { explainSymbol, filtersFromQuery } from '@pss/screen';
import { getStore } from '@/app/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol');
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  const store = await getStore();
  const snap = await store.latest();
  if (!snap) return NextResponse.json({ error: 'no snapshot' }, { status: 404 });

  const filters = filtersFromQuery(url.searchParams);
  return NextResponse.json({ symbol: symbol.toUpperCase(), contracts: explainSymbol(snap.rows, symbol, filters) });
}
