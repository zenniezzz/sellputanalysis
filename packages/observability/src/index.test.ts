import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heartbeat, initErrorReporting, reportError } from './index.js';

describe('heartbeat', () => {
  const KEY = 'HEARTBEAT_URL_SNAPSHOT';
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('is a no-op when the env var is unset', async () => {
    const f = vi.fn();
    expect(await heartbeat('snapshot', 'success', f as unknown as typeof fetch)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('POSTs the configured URL on success', async () => {
    process.env[KEY] = 'https://hc.example/abc';
    const f = vi.fn(async () => new Response('OK', { status: 200 }));
    expect(await heartbeat('snapshot', 'success', f as unknown as typeof fetch)).toBe(true);
    expect(f).toHaveBeenCalledWith('https://hc.example/abc', { method: 'POST' });
  });

  it('appends /fail for the fail state', async () => {
    process.env[KEY] = 'https://hc.example/abc';
    const f = vi.fn(async () => new Response('OK', { status: 200 }));
    await heartbeat('snapshot', 'fail', f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith('https://hc.example/abc/fail', { method: 'POST' });
  });
});

describe('error reporting', () => {
  it('falls back to console without a DSN', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await initErrorReporting();
    reportError(new Error('boom'), { where: 'test' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
