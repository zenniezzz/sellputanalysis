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
 */
export function PssAdapter(store: AuthStore): Adapter {
  return {
    async createUser(user) {
      const created = await store.createUser({
        email: user.email,
        name: user.name ?? null,
        image: user.image ?? null,
        emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null,
      });
      return toAdapterUser(created);
    },
    async getUser(id) {
      const u = await store.getUser(id);
      return u ? toAdapterUser(u) : null;
    },
    async getUserByEmail(email) {
      const u = await store.getUserByEmail(email);
      return u ? toAdapterUser(u) : null;
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const u = await store.getUserByAccount(provider, providerAccountId);
      return u ? toAdapterUser(u) : null;
    },
    async updateUser(user) {
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
      const saved = await store.createVerificationToken({
        identifier: vt.identifier,
        token: vt.token,
        expires: vt.expires.toISOString(),
      });
      return { identifier: saved.identifier, token: saved.token, expires: new Date(saved.expires) };
    },
    async useVerificationToken({ identifier, token }) {
      const used = await store.useVerificationToken(identifier, token);
      return used ? { identifier: used.identifier, token: used.token, expires: new Date(used.expires) } : null;
    },
  };
}
