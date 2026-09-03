import { randomUUID } from 'node:crypto';
import type { SavedScreen, UserData, UserDataStore } from '../userdata.js';
import type { PgQueryable } from './store.js';

export class PgUserDataStore implements UserDataStore {
  constructor(private readonly db: PgQueryable) {}

  async migrate(): Promise<void> {
    await this.db.query(`
      create table if not exists saved_screen (
        id uuid primary key,
        user_id uuid not null references app_user(id) on delete cascade,
        name text not null,
        query text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        unique (user_id, name)
      );
      create table if not exists watchlist_symbol (
        user_id uuid not null references app_user(id) on delete cascade,
        symbol text not null,
        primary key (user_id, symbol)
      );
    `);
  }

  private toScreen(r: Record<string, unknown>): SavedScreen {
    return {
      id: String(r['id']),
      name: String(r['name']),
      query: String(r['query']),
      createdAt: new Date(r['created_at'] as string).toISOString(),
      updatedAt: new Date(r['updated_at'] as string).toISOString(),
    };
  }

  async listScreens(userId: string): Promise<SavedScreen[]> {
    const { rows } = await this.db.query('select * from saved_screen where user_id = $1 order by name', [userId]);
    return rows.map((r) => this.toScreen(r));
  }

  async get(userId: string): Promise<UserData> {
    return { screens: await this.listScreens(userId), watchlist: await this.getWatchlist(userId) };
  }

  async saveScreen(userId: string, name: string, query: string, id?: string): Promise<SavedScreen> {
    const now = new Date().toISOString();
    const { rows } = await this.db.query(
      `insert into saved_screen (id, user_id, name, query, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$5)
       on conflict (user_id, name) do update set query = excluded.query, updated_at = excluded.updated_at
       returning *`,
      [id ?? randomUUID(), userId, name, query, now],
    );
    return this.toScreen(rows[0]!);
  }

  async deleteScreen(userId: string, id: string): Promise<void> {
    await this.db.query('delete from saved_screen where user_id = $1 and id = $2', [userId, id]);
  }

  async getWatchlist(userId: string): Promise<string[]> {
    const { rows } = await this.db.query(
      'select symbol from watchlist_symbol where user_id = $1 order by symbol',
      [userId],
    );
    return rows.map((r) => String(r['symbol']));
  }

  async setWatchlist(userId: string, symbols: string[]): Promise<string[]> {
    const norm = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
    await this.db.query('delete from watchlist_symbol where user_id = $1', [userId]);
    for (const s of norm) {
      await this.db.query('insert into watchlist_symbol (user_id, symbol) values ($1,$2)', [userId, s]);
    }
    return norm;
  }

  async toggleWatch(userId: string, symbol: string): Promise<string[]> {
    const s = symbol.trim().toUpperCase();
    const current = await this.getWatchlist(userId);
    return this.setWatchlist(userId, current.includes(s) ? current.filter((x) => x !== s) : [...current, s]);
  }
}
