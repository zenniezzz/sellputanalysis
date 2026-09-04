import { randomUUID } from 'node:crypto';
import type { AuthAccount, AuthStore, AuthUser, VerificationToken } from '../auth.js';
import type { PgQueryable } from './store.js';

export class PgAuthStore implements AuthStore {
  constructor(private readonly db: PgQueryable) {}

  async migrate(): Promise<void> {
    await this.db.query(`
      create extension if not exists citext;
      create table if not exists app_user (
        id uuid primary key,
        email citext unique not null,
        name text,
        image text,
        email_verified timestamptz
      );
      create table if not exists account (
        user_id uuid not null references app_user(id) on delete cascade,
        type text not null,
        provider text not null,
        provider_account_id text not null,
        refresh_token text, access_token text, expires_at bigint,
        token_type text, scope text, id_token text,
        primary key (provider, provider_account_id)
      );
      create table if not exists verification_token (
        identifier text not null,
        token text not null,
        expires timestamptz not null,
        primary key (identifier, token)
      );
    `);
  }

  private toUser(r: Record<string, unknown> | undefined): AuthUser | null {
    if (!r) return null;
    return {
      id: String(r['id']),
      email: String(r['email']),
      name: (r['name'] as string | null) ?? null,
      image: (r['image'] as string | null) ?? null,
      emailVerified: r['email_verified'] ? new Date(r['email_verified'] as string).toISOString() : null,
    };
  }

  async createUser(user: Omit<AuthUser, 'id'> & { id?: string }): Promise<AuthUser> {
    const existing = await this.getUserByEmail(user.email);
    if (existing) return existing;
    const id = user.id ?? randomUUID();
    await this.db.query(
      `insert into app_user (id, email, name, image, email_verified) values ($1,$2,$3,$4,$5)`,
      [id, user.email, user.name ?? null, user.image ?? null, user.emailVerified ?? null],
    );
    return { id, email: user.email, name: user.name ?? null, image: user.image ?? null, emailVerified: user.emailVerified ?? null };
  }

  async getUser(id: string): Promise<AuthUser | null> {
    return this.toUser((await this.db.query('select * from app_user where id = $1', [id])).rows[0]);
  }

  async getUserByEmail(email: string): Promise<AuthUser | null> {
    return this.toUser((await this.db.query('select * from app_user where email = $1', [email])).rows[0]);
  }

  async getUserByAccount(provider: string, providerAccountId: string): Promise<AuthUser | null> {
    const { rows } = await this.db.query(
      `select u.* from app_user u join account a on a.user_id = u.id
       where a.provider = $1 and a.provider_account_id = $2`,
      [provider, providerAccountId],
    );
    return this.toUser(rows[0]);
  }

  async updateUser(user: Partial<AuthUser> & { id: string }): Promise<AuthUser> {
    await this.db.query(
      `update app_user set
         email = coalesce($2, email), name = coalesce($3, name),
         image = coalesce($4, image), email_verified = coalesce($5, email_verified)
       where id = $1`,
      [user.id, user.email ?? null, user.name ?? null, user.image ?? null, user.emailVerified ?? null],
    );
    return (await this.getUser(user.id))!;
  }

  async linkAccount(a: AuthAccount): Promise<void> {
    await this.db.query(
      `insert into account (user_id, type, provider, provider_account_id, refresh_token, access_token, expires_at, token_type, scope, id_token)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (provider, provider_account_id) do nothing`,
      [a.userId, a.type, a.provider, a.providerAccountId, a.refresh_token ?? null, a.access_token ?? null, a.expires_at ?? null, a.token_type ?? null, a.scope ?? null, a.id_token ?? null],
    );
  }

  async createVerificationToken(vt: VerificationToken): Promise<VerificationToken> {
    await this.db.query(
      `insert into verification_token (identifier, token, expires) values ($1,$2,$3)
       on conflict (identifier, token) do update set expires = excluded.expires`,
      [vt.identifier, vt.token, vt.expires],
    );
    return vt;
  }

  async useVerificationToken(identifier: string, token: string): Promise<VerificationToken | null> {
    const { rows } = await this.db.query(
      `delete from verification_token where identifier = $1 and token = $2 returning *`,
      [identifier, token],
    );
    const r = rows[0];
    if (!r) return null;
    const expires = new Date(r['expires'] as string).toISOString();
    if (new Date(expires).getTime() < Date.now()) return null;
    return { identifier, token, expires };
  }
}
