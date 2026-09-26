/**
 * Limits password guesses on the connector sign-in page: after too many failures for one account,
 * that account cannot sign in here until the window passes.
 *
 * Counted per account rather than per address because every request reaches the API through the
 * host's proxy, so addresses do not tell people apart. The cost is that someone who knows an
 * allowed email can hold that account out of the connector for a while; they still cannot get in.
 * Kept in memory: the API runs as one instance, and a restart forgetting the count is acceptable.
 */
export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;

export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  allow(key: string): boolean {
    const entry = this.current(key);
    return !entry || entry.count < MAX_FAILURES;
  }

  fail(key: string): void {
    const entry = this.current(key) ?? { count: 0, resetAt: this.now() + WINDOW_MS };
    entry.count += 1;
    this.failures.set(key, entry);
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }

  private current(key: string) {
    const entry = this.failures.get(key);
    if (entry && entry.resetAt <= this.now()) {
      this.failures.delete(key);
      return undefined;
    }
    return entry;
  }
}
