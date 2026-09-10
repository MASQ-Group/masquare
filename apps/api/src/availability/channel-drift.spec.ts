import { describe, expect, it } from 'vitest';
import { channelDrifted } from './channel-drift';

/**
 * The null cases carry the weight here. Getting the mismatch right is arithmetic; getting "we do
 * not know" right is the part that decides whether the banner tells the truth on a product nobody
 * has ever pushed.
 */
describe('channelDrifted', () => {
  /** The reported case: MAR-EM-JE091-BA sold its last unit and a channel still advertised one. */
  it('reports a channel still advertising stock we no longer hold', () => {
    expect(channelDrifted(0, 1)).toBe(true);
  });

  it('reports a mismatch in either direction', () => {
    expect(channelDrifted(5, 2)).toBe(true);
    expect(channelDrifted(2, 5)).toBe(true);
  });

  it('is quiet when the figures agree', () => {
    expect(channelDrifted(0, 0)).toBe(false);
    expect(channelDrifted(3, 3)).toBe(false);
  });

  /**
   * A listing we have only ever pulled has no record of a figure sent. Reading that as 0 would
   * manufacture drift against every product in the catalogue that has never been pushed.
   */
  it('does not call a never-pushed listing drifted', () => {
    expect(channelDrifted(0, null)).toBe(false);
    expect(channelDrifted(4, null)).toBe(false);
  });

  /**
   * No availability row is not the same as none in stock — the distinction the whole availability
   * module is built on. Nothing can be compared against it.
   */
  it('does not compare against an unknown holding', () => {
    expect(channelDrifted(null, 0)).toBe(false);
    expect(channelDrifted(null, 7)).toBe(false);
  });

  it('says nothing when neither side is known', () => {
    expect(channelDrifted(null, null)).toBe(false);
    expect(channelDrifted(undefined, undefined)).toBe(false);
  });
});
