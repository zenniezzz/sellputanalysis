import { describe, expect, it } from 'vitest';
import { RateLimiter, clientIp } from './rate-limit';

describe('RateLimiter', () => {
  it('allows up to the limit, then blocks within the window', () => {
    let t = 1_000;
    const rl = new RateLimiter(3, 60_000, () => t);
    expect(rl.check('a').ok).toBe(true);
    expect(rl.check('a').ok).toBe(true);
    const third = rl.check('a');
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = rl.check('a');
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterMs).toBe(60_000);
  });

  it('resets after the window elapses', () => {
    let t = 0;
    const rl = new RateLimiter(1, 1_000, () => t);
    expect(rl.check('a').ok).toBe(true);
    expect(rl.check('a').ok).toBe(false);
    t = 1_000;
    expect(rl.check('a').ok).toBe(true);
  });

  it('tracks keys independently', () => {
    let t = 0;
    const rl = new RateLimiter(1, 1_000, () => t);
    expect(rl.check('a').ok).toBe(true);
    expect(rl.check('b').ok).toBe(true);
    expect(rl.check('a').ok).toBe(false);
  });

  it('sweep drops only expired windows', () => {
    let t = 0;
    const rl = new RateLimiter(5, 1_000, () => t);
    rl.check('old');
    t = 500;
    rl.check('fresh');
    t = 1_200;
    rl.sweep();
    // 'old' expired at 1_000, 'fresh' expires at 1_500
    expect(rl.check('fresh').remaining).toBe(3); // second hit on the still-open window
    expect(rl.check('old').remaining).toBe(4); // brand-new window
  });
});

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip then unknown', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
