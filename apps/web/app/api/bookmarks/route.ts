import { NextResponse } from 'next/server';
import { currentUserId } from '@/app/lib/session';
import { getBookmarkStore } from '@/app/lib/bookmarks';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ bookmarks: [] });
  return NextResponse.json({ bookmarks: await getBookmarkStore().list(uid) });
}

export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const body = (await req.json()) as {
    name?: string;
    snapshotRunId?: string;
    filterQuery?: string;
  };
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (!body.snapshotRunId)
    return NextResponse.json({ error: 'snapshotRunId required' }, { status: 400 });
  const bookmark = await getBookmarkStore().create(
    uid,
    name,
    body.snapshotRunId,
    body.filterQuery ?? '',
  );
  return NextResponse.json({ bookmark });
}
