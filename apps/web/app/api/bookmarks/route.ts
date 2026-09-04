import { NextResponse } from 'next/server';
import { currentUserId } from '@/app/lib/session';
import { getBookmarkStore } from '@/app/lib/bookmarks';
import { cleanName, cleanQueryString } from '@/app/lib/validate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ bookmarks: [] });
  return NextResponse.json({ bookmarks: await (await getBookmarkStore()).list(uid) });
}

export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    snapshotRunId?: unknown;
    filterQuery?: unknown;
  };
  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (typeof body.snapshotRunId !== 'string' || !body.snapshotRunId)
    return NextResponse.json({ error: 'snapshotRunId required' }, { status: 400 });
  const bookmark = await (await getBookmarkStore()).create({
    userId: uid,
    name,
    snapshotRunId: body.snapshotRunId,
    filterQuery: cleanQueryString(body.filterQuery),
  });
  return NextResponse.json({ bookmark });
}
