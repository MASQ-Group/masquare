import { describe, expect, it } from 'vitest';
import { RETURN_PARAM, isInternalPath, withReturn } from './useBackLink';

describe('withReturn', () => {
  it('carries the origin path and its query, so the return lands on the same view', () => {
    expect(withReturn('/sales-transactions/abc/edit', { pathname: '/shipments-tracking', search: '?tab=delivered' }))
      .toBe(`/sales-transactions/abc/edit?${RETURN_PARAM}=%2Fshipments-tracking%3Ftab%3Ddelivered`);
  });

  /** The destination may already carry its own parameters — Stock Owed links to a filtered list. */
  it('appends rather than replacing an existing query string', () => {
    const out = withReturn('/sales-transactions?q=T6BWXDB', { pathname: '/stock-owed', search: '' });
    expect(out).toBe(`/sales-transactions?q=T6BWXDB&${RETURN_PARAM}=%2Fstock-owed`);
  });
});

describe('isInternalPath', () => {
  it('accepts a path inside the app', () => {
    expect(isInternalPath('/shipments-tracking')).toBe(true);
    expect(isInternalPath('/sales-transactions?q=abc')).toBe(true);
  });

  /**
   * This value arrives from the address bar, where anyone can type it, and it is rendered as the
   * target of a button in our own chrome. A protocol-relative URL and an absolute one are both
   * things a browser would happily leave the app for.
   */
  it('refuses anything that could leave the app', () => {
    expect(isInternalPath('//evil.example/login')).toBe(false);
    expect(isInternalPath('https://evil.example')).toBe(false);
    expect(isInternalPath('javascript:alert(1)')).toBe(false);
    expect(isInternalPath('shipments-tracking')).toBe(false);
    expect(isInternalPath('')).toBe(false);
  });
});
