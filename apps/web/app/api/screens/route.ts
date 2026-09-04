import { NextResponse } from 'next/server';
import { currentUserId } from '@/app/lib/session';
import { getUserDataStore } from '@/app/lib/stores';
import { cleanName, cleanQueryString } from '@/app/lib/validate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ screens: [] });
  return NextResponse.json({ screens: await getUserDataStore().listScreens(uid) });
}

export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; query?: unknown; id?: unknown };
  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const id = typeof body.id === 'string' ? body.id : undefined;
  const screen = await getUserDataStore().saveScreen(uid, name, cleanQueryString(body.query), id);
  return NextResponse.json({ screen });
}
