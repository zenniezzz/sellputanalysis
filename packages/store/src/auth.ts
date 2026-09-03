/**
 * Auth-adapter data store (plan §9.3, milestone M3.5).
 *
 * Backs the subset of the Auth.js adapter contract needed for a JWT session
 * strategy with email-magic-link and OAuth: users, linked accounts, and
 * verification tokens. Sessions themselves are stateless JWTs.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  /** ISO timestamp, or null. */
  emailVerified?: string | null;
}

export interface AuthAccount {
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
  refresh_token?: string | null;
  access_token?: string | null;
  expires_at?: number | null;
  token_type?: string | null;
  scope?: string | null;
  id_token?: string | null;
}

export interface VerificationToken {
  identifier: string;
  token: string;
  /** ISO timestamp. */
  expires: string;
}

export interface AuthStore {
  createUser(user: Omit<AuthUser, 'id'> & { id?: string }): Promise<AuthUser>;
  getUser(id: string): Promise<AuthUser | null>;
  getUserByEmail(email: string): Promise<AuthUser | null>;
  getUserByAccount(provider: string, providerAccountId: string): Promise<AuthUser | null>;
  updateUser(user: Partial<AuthUser> & { id: string }): Promise<AuthUser>;
  linkAccount(account: AuthAccount): Promise<void>;
  createVerificationToken(vt: VerificationToken): Promise<VerificationToken>;
  /** Returns and consumes the token, or null if unknown/expired. */
  useVerificationToken(identifier: string, token: string): Promise<VerificationToken | null>;
}

interface AuthData {
  users: AuthUser[];
  accounts: AuthAccount[];
  tokens: VerificationToken[];
}

export class JsonAuthStore implements AuthStore {
  constructor(private readonly file: string) {}

  private async read(): Promise<AuthData> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as AuthData;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { users: [], accounts: [], tokens: [] };
      throw e;
    }
  }

  private async write(data: AuthData): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(data, null, 2)}\n`);
  }

  async createUser(user: Omit<AuthUser, 'id'> & { id?: string }): Promise<AuthUser> {
    const data = await this.read();
    const existing = data.users.find((u) => u.email.toLowerCase() === user.email.toLowerCase());
    if (existing) return existing;
    const created: AuthUser = {
      id: user.id ?? randomUUID(),
      email: user.email,
      name: user.name ?? null,
      image: user.image ?? null,
      emailVerified: user.emailVerified ?? null,
    };
    data.users.push(created);
    await this.write(data);
    return created;
  }

  async getUser(id: string): Promise<AuthUser | null> {
    return (await this.read()).users.find((u) => u.id === id) ?? null;
  }

  async getUserByEmail(email: string): Promise<AuthUser | null> {
    return (await this.read()).users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async getUserByAccount(provider: string, providerAccountId: string): Promise<AuthUser | null> {
    const data = await this.read();
    const acct = data.accounts.find((a) => a.provider === provider && a.providerAccountId === providerAccountId);
    return acct ? (data.users.find((u) => u.id === acct.userId) ?? null) : null;
  }

  async updateUser(user: Partial<AuthUser> & { id: string }): Promise<AuthUser> {
    const data = await this.read();
    const idx = data.users.findIndex((u) => u.id === user.id);
    if (idx < 0) throw new Error(`updateUser: unknown id ${user.id}`);
    data.users[idx] = { ...data.users[idx]!, ...user };
    await this.write(data);
    return data.users[idx]!;
  }

  async linkAccount(account: AuthAccount): Promise<void> {
    const data = await this.read();
    const dup = data.accounts.some(
      (a) => a.provider === account.provider && a.providerAccountId === account.providerAccountId,
    );
    if (!dup) data.accounts.push(account);
    await this.write(data);
  }

  async createVerificationToken(vt: VerificationToken): Promise<VerificationToken> {
    const data = await this.read();
    data.tokens = data.tokens.filter((t) => !(t.identifier === vt.identifier && t.token === vt.token));
    data.tokens.push(vt);
    await this.write(data);
    return vt;
  }

  async useVerificationToken(identifier: string, token: string): Promise<VerificationToken | null> {
    const data = await this.read();
    const idx = data.tokens.findIndex((t) => t.identifier === identifier && t.token === token);
    if (idx < 0) return null;
    const [used] = data.tokens.splice(idx, 1);
    await this.write(data);
    if (!used || new Date(used.expires).getTime() < Date.now()) return null;
    return used;
  }
}
