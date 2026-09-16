import { describe, expect, it } from 'vitest';
import { profitResultFresh } from './profitResultFresh';

describe('profitResultFresh', () => {
  it('shows an answer that covers exactly the prices asked', () => {
    expect(profitResultFresh([2100, 3999], [2100, 3999])).toBe(true);
  });

  /** The bug this replaced: the answer arrived and nothing was ever shown. */
  it('shows an answer for a single price', () => {
    expect(profitResultFresh([2100], [2100])).toBe(true);
  });

  it('hides an answer once a price is edited', () => {
    expect(profitResultFresh([2100, 3999], [2200, 3999])).toBe(false);
    expect(profitResultFresh([2100, 3999], [2100])).toBe(false);
  });

  it('counts the same price asked twice as one, because the server answers it once', () => {
    expect(profitResultFresh([2100], [2100, 2100])).toBe(true);
  });

  it('shows nothing when there is no answer or nothing was asked', () => {
    expect(profitResultFresh(undefined, [2100])).toBe(false);
    expect(profitResultFresh([], [])).toBe(false);
  });
});
