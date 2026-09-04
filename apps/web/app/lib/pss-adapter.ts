import 'server-only';
import type { Adapter, AdapterAccount, AdapterUser } from 'next-auth/adapters';
import type { AuthStore, AuthUser } from '@pss/store';

const toAdapterUser = (u: AuthUser): AdapterUser => ({
  id: u.id,
  email: u.email,
  emailVerified: u.emailVerified ? new Date(u.emailVerified) : null,
  name: u.name ?? null,
  image: u.image ?? null,
});

/**
 * Auth.js adapter over @pss/store's AuthStore. JWT session strategy, so the
 * session methods are unused; email-magic-link + OAuth need the rest.
 *
 * Takes a *getter* rather than a resolved store: which store backs this
 * (JSON vs. the shared Postgres pool) is decided lazily on first use
 * (`getAuthStore` in app/lib/stores.ts), and NextAuth builds its config
 * object at module load time, before any request (and its env) exists.
 */
export function PssAdapter(getStore: () => Promise<AuthStore>): Adapter {
  return {
    async createUser(user) {
      const store = await getStore();
      const created = await store.createUser({
        email: user.email,
        name: user.name ?? null,
        image: user.image ?? null,
        emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null,
      });
      return toAdapterUser(created);
    },
    async getUser(id) {
      const u = await (await getStore()).getUser(id);
      return u ? toAdapterUser(u) : null;
    },
    async getUserByEmail(email) {
      const u = await (await getStore()).getUserByEmail(email);
      return u ? toAdapterUser(u) : null;
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const u = await (await getStore()).getUserByAccount(provider, providerAccountId);
      return u ? toAdapterUser(u) : null;
    },
    async updateUser(user) {
      const store = await getStore();
      const updated = await store.updateUser({
        id: user.id!,
        ...(user.email ? { email: user.email } : {}),
        ...(user.name !== undefined ? { name: user.name } : {}),
        ...(user.image !== undefined ? { image: user.image } : {}),
        ...(user.emailVerified !== undefined
          ? { emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null }
          : {}),
      });
      return toAdapterUser(updated);
    },
    async linkAccount(account: AdapterAccount) {
      const store = await getStore();
      await store.linkAccount({
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        refresh_token: account.refresh_token ?? null,
        access_token: account.access_token ?? null,
        expires_at: account.expires_at ?? null,
        token_type: (account.token_type as string | undefined) ?? null,
        scope: account.scope ?? null,
        id_token: account.id_token ?? null,
      });
    },
    async createVerificationToken(vt) {
      const store = await getStore();
      const saved = await store.createVerificationToken({
        identifier: vt.identifier,
        token: vt.token,
        expires: vt.expires.toISOString(),
      });
      return { identifier: saved.identifier, token: saved.token, expires: new Date(saved.expires) };
    },
    async useVerificationToken({ identifier, token }) {
      const used = await (await getStore()).useVerificationToken(identifier, token);
      return used ? { identifier: used.identifier, token: used.token, expires: new Date(used.expires) } : null;
    },
  };
}
