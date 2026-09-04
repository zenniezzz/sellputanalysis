import 'server-only';
import type { ScreenContext } from '@pss/screen';
import { auth } from '@/auth';
import { getUserDataStore } from './stores';

export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** Session context for @pss/screen — the signed-in user's watchlist, or empty. */
export async function screenContext(): Promise<ScreenContext> {
  const uid = await currentUserId();
  if (!uid) return {};
  return { watchlist: await (await getUserDataStore()).getWatchlist(uid) };
}

export async function currentUser(): Promise<{ id: string; email?: string | null } | null> {
  const session = await auth();
  return session?.user?.id ? { id: session.user.id, email: session.user.email } : null;
}
