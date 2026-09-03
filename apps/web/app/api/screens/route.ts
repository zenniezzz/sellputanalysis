import { NextResponse } from 'next/server';
import { currentUserId } from '@/app/lib/session';
import { getUserDataStore } from '@/app/lib/stores';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ screens: [] });
  return NextResponse.json({ screens: await getUserDataStore().listScreens(uid) });
}

export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const body = (await req.json()) as { name?: string; query?: string; id?: string };
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const screen = await getUserDataStore().saveScreen(uid, name, body.query ?? '', body.id);
  return NextResponse.json({ screen });
}
