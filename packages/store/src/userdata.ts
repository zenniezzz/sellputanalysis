/**
 * Per-user data: saved screens and watchlists (plan §9.3, milestone M3.5).
 * `frozen_comparison` lands with M4/M5. Keyed by the Auth.js user id.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export interface SavedScreen {
  id: string;
  name: string;
  /** URL query string produced by @pss/screen's filtersToQuery. */
  query: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserData {
  screens: SavedScreen[];
  watchlist: string[];
}

const EMPTY: UserData = { screens: [], watchlist: [] };

export interface UserDataStore {
  get(userId: string): Promise<UserData>;
  listScreens(userId: string): Promise<SavedScreen[]>;
  saveScreen(userId: string, name: string, query: string, id?: string): Promise<SavedScreen>;
  deleteScreen(userId: string, id: string): Promise<void>;
  getWatchlist(userId: string): Promise<string[]>;
  setWatchlist(userId: string, symbols: string[]): Promise<string[]>;
  toggleWatch(userId: string, symbol: string): Promise<string[]>;
}

function normSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
}

export class JsonUserDataStore implements UserDataStore {
  constructor(private readonly root: string) {}

  private file(userId: string): string {
    return join(this.root, `${encodeURIComponent(userId)}.json`);
  }

  private async read(userId: string): Promise<UserData> {
    try {
      const raw = JSON.parse(await readFile(this.file(userId), 'utf8')) as Partial<UserData>;
      return { screens: raw.screens ?? [], watchlist: raw.watchlist ?? [] };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
      throw e;
    }
  }

  private async write(userId: string, data: UserData): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.file(userId), `${JSON.stringify(data, null, 2)}\n`);
  }

  async get(userId: string): Promise<UserData> {
    return this.read(userId);
  }

  async listScreens(userId: string): Promise<SavedScreen[]> {
    return (await this.read(userId)).screens;
  }

  async saveScreen(userId: string, name: string, query: string, id?: string): Promise<SavedScreen> {
    const data = await this.read(userId);
    const now = new Date().toISOString();
    const existing = id ? data.screens.find((s) => s.id === id) : data.screens.find((s) => s.name === name);
    let screen: SavedScreen;
    if (existing) {
      screen = { ...existing, name, query, updatedAt: now };
      data.screens = data.screens.map((s) => (s.id === existing.id ? screen : s));
    } else {
      screen = { id: randomUUID(), name, query, createdAt: now, updatedAt: now };
      data.screens.push(screen);
    }
    data.screens.sort((a, b) => a.name.localeCompare(b.name));
    await this.write(userId, data);
    return screen;
  }

  async deleteScreen(userId: string, id: string): Promise<void> {
    const data = await this.read(userId);
    data.screens = data.screens.filter((s) => s.id !== id);
    await this.write(userId, data);
  }

  async getWatchlist(userId: string): Promise<string[]> {
    return normSymbols((await this.read(userId)).watchlist);
  }

  async setWatchlist(userId: string, symbols: string[]): Promise<string[]> {
    const data = await this.read(userId);
    data.watchlist = normSymbols(symbols);
    await this.write(userId, data);
    return data.watchlist;
  }

  async toggleWatch(userId: string, symbol: string): Promise<string[]> {
    const s = symbol.trim().toUpperCase();
    const current = await this.getWatchlist(userId);
    return this.setWatchlist(userId, current.includes(s) ? current.filter((x) => x !== s) : [...current, s]);
  }
}
