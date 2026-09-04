import { NextResponse } from 'next/server';
import { calibrationReport } from '@pss/tracker';
import { currentUserId } from '@/app/lib/session';
import { getPaperTradeStore } from '@/app/lib/trades';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ report: calibrationReport([]) });
  return NextResponse.json({ report: calibrationReport(await getPaperTradeStore().list(uid)) });
}
