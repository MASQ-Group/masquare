import { describe, expect, it } from 'vitest';
import { EbayScopeMemory } from './ebay-scope-memory';

const WRITE = ['api_scope', 'sell.inventory'];
const READ = ['api_scope', 'sell.inventory.readonly'];
const key = (token: string, requested = WRITE) => EbayScopeMemory.keyOf('app-1', token, requested);

describe('EbayScopeMemory', () => {
  it('asks for the configured scopes until told otherwise', () => {
    expect(new EbayScopeMemory().firstToTry(key('tok'))).toBe(0);
  });

  it('starts at the set that worked last time', () => {
    const m = new EbayScopeMemory();
    m.remember(key('tok'), 2);
    expect(m.firstToTry(key('tok'))).toBe(2);
  });

  /** The point of the whole class: one warning per token, not one per eBay call. */
  it('reports the fallback as news only the first time', () => {
    const m = new EbayScopeMemory();
    expect(m.remember(key('tok'), 2)).toBe(true);
    expect(m.remember(key('tok'), 2)).toBe(false);
  });

  it('says nothing when the configured scopes are accepted', () => {
    expect(new EbayScopeMemory().remember(key('tok'), 0)).toBe(false);
  });

  it('reports a token that has widened back to the configured set', () => {
    const m = new EbayScopeMemory();
    m.remember(key('tok'), 2);
    expect(m.remember(key('tok'), 0)).toBe(true);
  });

  /** A reconnect stores a new refresh token; whatever the old one could not do proves nothing. */
  it('probes again from the top after the integration is reconnected', () => {
    const m = new EbayScopeMemory();
    m.remember(key('old-token'), 2);
    expect(m.firstToTry(key('new-token'))).toBe(0);
  });

  /** Switching the write opt-in on changes what we ask for, so the old refusal no longer applies. */
  it('probes again from the top when the requested set changes', () => {
    const m = new EbayScopeMemory();
    m.remember(key('tok', READ), 2);
    expect(m.firstToTry(key('tok', WRITE))).toBe(0);
  });

  it('keeps one answer per credential, however the scopes are ordered', () => {
    const m = new EbayScopeMemory();
    m.remember(key('tok', WRITE), 1);
    expect(m.firstToTry(key('tok', [...WRITE].reverse()))).toBe(1);
  });

  it('never holds the refresh token itself as a key', () => {
    expect(key('super-secret-token')).not.toContain('super-secret-token');
  });
});
