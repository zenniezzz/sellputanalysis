import 'server-only';
import { join } from 'node:path';
import { JsonAuthStore, JsonUserDataStore, type AuthStore, type UserDataStore } from '@pss/store';

const DATA_DIR = process.env.PSS_DATA_DIR
  ? join(process.env.PSS_DATA_DIR, '..')
  : join(process.cwd(), '..', '..', '.data');

let authStore: AuthStore | null = null;
let userDataStore: UserDataStore | null = null;

export function getAuthStore(): AuthStore {
  authStore ??= new JsonAuthStore(join(DATA_DIR, 'auth', 'auth.json'));
  return authStore;
}

export function getUserDataStore(): UserDataStore {
  userDataStore ??= new JsonUserDataStore(join(DATA_DIR, 'userdata'));
  return userDataStore;
}
