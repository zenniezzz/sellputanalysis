import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonAuthStore } from './auth.js';
import { JsonUserDataStore } from './userdata.js';

describe('JsonAuthStore', () => {
  let file: string;
  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'pss-auth-')), 'auth.json');
  });
  afterEach(async () => {
    await rm(file, { force: true });
  });

  it('creates + fetches a user, idempotent on email', async () => {
    const s = new JsonAuthStore(file);
    const u1 = await s.createUser({ email: 'a@b.com', name: 'A' });
    const u2 = await s.createUser({ email: 'A@B.com' });
    expect(u2.id).toBe(u1.id);
    expect((await s.getUserByEmail('a@b.com'))?.id).toBe(u1.id);
    expect((await s.getUser(u1.id))?.email).toBe('a@b.com');
  });

  it('links an account and resolves the user by it', async () => {
    const s = new JsonAuthStore(file);
    const u = await s.createUser({ email: 'g@x.com' });
    await s.linkAccount({ userId: u.id, type: 'oauth', provider: 'google', providerAccountId: '123' });
    await s.linkAccount({ userId: u.id, type: 'oauth', provider: 'google', providerAccountId: '123' }); // idempotent
    expect((await s.getUserByAccount('google', '123'))?.id).toBe(u.id);
    expect(await s.getUserByAccount('google', 'nope')).toBeNull();
  });

  it('verification token is single-use and honors expiry', async () => {
    const s = new JsonAuthStore(file);
    const future = new Date(Date.now() + 60_000).toISOString();
    await s.createVerificationToken({ identifier: 'a@b.com', token: 'tok', expires: future });
    expect((await s.useVerificationToken('a@b.com', 'tok'))?.token).toBe('tok');
    expect(await s.useVerificationToken('a@b.com', 'tok')).toBeNull(); // consumed

    const past = new Date(Date.now() - 1000).toISOString();
    await s.createVerificationToken({ identifier: 'c@d.com', token: 'old', expires: past });
    expect(await s.useVerificationToken('c@d.com', 'old')).toBeNull(); // expired
  });

  it('updateUser marks the email verified', async () => {
    const s = new JsonAuthStore(file);
    const u = await s.createUser({ email: 'v@x.com' });
    const now = new Date().toISOString();
    const updated = await s.updateUser({ id: u.id, emailVerified: now });
    expect(updated.emailVerified).toBe(now);
  });
});

describe('JsonUserDataStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pss-ud-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves, lists, updates by name, and deletes screens', async () => {
    const s = new JsonUserDataStore(dir);
    const a = await s.saveScreen('u1', 'High IV', 'minIvRankOrPctile=60');
    await s.saveScreen('u1', 'High IV', 'minIvRankOrPctile=70'); // same name → update
    const list = await s.listScreens('u1');
    expect(list).toHaveLength(1);
    expect(list[0]!.query).toBe('minIvRankOrPctile=70');
    expect(list[0]!.id).toBe(a.id);

    await s.saveScreen('u1', 'Conservative', 'deltaHi=0.25');
    expect((await s.listScreens('u1')).map((x) => x.name)).toEqual(['Conservative', 'High IV']);

    await s.deleteScreen('u1', a.id);
    expect((await s.listScreens('u1')).map((x) => x.name)).toEqual(['Conservative']);
  });

  it('watchlist normalizes, dedupes, sorts, and toggles', async () => {
    const s = new JsonUserDataStore(dir);
    await s.setWatchlist('u1', [' nvda ', 'AAPL', 'nvda']);
    expect(await s.getWatchlist('u1')).toEqual(['AAPL', 'NVDA']);
    expect(await s.toggleWatch('u1', 'msft')).toEqual(['AAPL', 'MSFT', 'NVDA']);
    expect(await s.toggleWatch('u1', 'AAPL')).toEqual(['MSFT', 'NVDA']);
  });

  it('isolates users', async () => {
    const s = new JsonUserDataStore(dir);
    await s.setWatchlist('u1', ['AAPL']);
    await s.setWatchlist('u2', ['TSLA']);
    expect(await s.getWatchlist('u1')).toEqual(['AAPL']);
    expect(await s.getWatchlist('u2')).toEqual(['TSLA']);
  });
});
