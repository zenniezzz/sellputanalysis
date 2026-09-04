import { NextResponse } from 'next/server';
import { currentUserId } from '@/app/lib/session';
import { getBookmarkStore } from '@/app/lib/bookmarks';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const { id } = await params;
  await getBookmarkStore().delete(uid, id);
  return NextResponse.json({ ok: true });
}
