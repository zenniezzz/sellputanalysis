import { NextResponse } from 'next/server';
import { getStore } from '@/app/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = await getStore();
  return NextResponse.json({ snapshots: await store.list(50) });
}
