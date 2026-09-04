import { NextResponse } from 'next/server';
import { currentUserId } from '@/app/lib/session';
import { getUserDataStore } from '@/app/lib/stores';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  const { id } = await params;
  await (await getUserDataStore()).deleteScreen(uid, id);
  return NextResponse.json({ ok: true });
}
