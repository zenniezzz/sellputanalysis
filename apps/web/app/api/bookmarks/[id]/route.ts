import { NextResponse } from 'next/server';
import { currentUserId } from '@/app/lib/session';
import { getBookmarkStore } from '@/app/lib/bookmarks';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  await getBookmarkStore().delete(uid, params.id);
  return NextResponse.json({ ok: true });
}
