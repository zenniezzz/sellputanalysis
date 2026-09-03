import { NextResponse } from 'next/server';
import { getStore } from '@/app/lib/store';
import { diffSnapshots } from '@/app/lib/diff';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const a = params.get('a');
  const b = params.get('b');
  if (!a || !b) return NextResponse.json({ error: 'a and b required' }, { status: 400 });

  const store = await getStore();
  const [prev, next] = await Promise.all([store.getByRunId(a), store.getByRunId(b)]);
  if (!prev || !next) return NextResponse.json({ error: 'snapshot not found' }, { status: 404 });

  return NextResponse.json(diffSnapshots(prev, next));
}
