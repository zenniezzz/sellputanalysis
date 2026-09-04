import { NextResponse } from 'next/server';
import { getStore } from '@/app/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snap = await (await getStore()).latest();
  if (!snap) return NextResponse.json({ error: 'no snapshot' }, { status: 404 });
  return NextResponse.json({ meta: snap.meta, universe: snap.universe });
}
