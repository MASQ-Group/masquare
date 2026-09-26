import { describe, expect, it } from 'vitest';
import { LoginThrottle, MAX_FAILURES, WINDOW_MS } from './login-throttle';

describe('LoginThrottle', () => {
  it('stops an account after too many failures, and lets it try again once the window passes', () => {
    let now = 1_000;
    const t = new LoginThrottle(() => now);
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect(t.allow('a@x.eu')).toBe(true);
      t.fail('a@x.eu');
    }
    expect(t.allow('a@x.eu')).toBe(false);
    expect(t.allow('b@x.eu')).toBe(true);

    now += WINDOW_MS;
    expect(t.allow('a@x.eu')).toBe(true);
  });

  it('forgets the failures after a successful sign-in', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < MAX_FAILURES - 1; i++) t.fail('a@x.eu');
    t.succeed('a@x.eu');
    t.fail('a@x.eu');
    expect(t.allow('a@x.eu')).toBe(true);
  });
});
