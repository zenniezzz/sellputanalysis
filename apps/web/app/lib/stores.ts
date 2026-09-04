import 'server-only';
import { join } from 'node:path';
import {
  JsonAuthStore,
  JsonUserDataStore,
  PgAuthStore,
  PgUserDataStore,
  type AuthStore,
  type UserDataStore,
} from '@pss/store';
import { getPgPool } from './pg-pool';

const DATA_DIR = process.env.PSS_DATA_DIR
  ? join(process.env.PSS_DATA_DIR, '..')
  : join(process.cwd(), '..', '..', '.data');

let authStore: Promise<AuthStore> | null = null;
let userDataStore: Promise<UserDataStore> | null = null;

/** JSON-backed by default; Postgres (via the shared pool) when DATABASE_URL is set. */
export async function getAuthStore(): Promise<AuthStore> {
  authStore ??= (async () => {
    const pool = await getPgPool();
    if (pool) {
      const store = new PgAuthStore(pool);
      await store.migrate();
      return store;
    }
    return new JsonAuthStore(join(DATA_DIR, 'auth', 'auth.json'));
  })();
  return authStore;
}

export async function getUserDataStore(): Promise<UserDataStore> {
  userDataStore ??= (async () => {
    const pool = await getPgPool();
    if (pool) {
      // saved_screen/watchlist_symbol both FK-reference app_user — that table
      // only exists once PgAuthStore has migrated, so make sure it has.
      await getAuthStore();
      const store = new PgUserDataStore(pool);
      await store.migrate();
      return store;
    }
    return new JsonUserDataStore(join(DATA_DIR, 'userdata'));
  })();
  return userDataStore;
}
