import { describe, expect, it } from 'vitest';
import { parseHandlingDays, parseMarginPct, verdictFor, type BulkChannelFacts } from './bulk-listing';

const ok = (over: Partial<BulkChannelFacts> = {}): BulkChannelFacts => ({
  found: true,
  restricted: false,
  alreadyListed: false,
  eligible: true,
  eligibilityReasons: [],
  asin: 'B00X',
  priceCents: 5000,
  priceReason: null,
  quantity: 4,
  handlingTimeDays: 2,
  brandRestriction: null,
  ...over,
});

describe('which channels a bulk listing may touch', () => {
  it('lists one that is ready', () => {
    expect(verdictFor(ok())).toMatchObject({ canList: true, blockers: [] });
  });

  it('names every blocker, not just the first', () => {
    // Fixing one blocker at a time, re-running a fan-out across eighteen marketplaces each time, is
    // a slow way to discover four problems.
    const v = verdictFor(ok({ found: false, asin: null, quantity: null, handlingTimeDays: null }));
    expect(v.canList).toBe(false);
    expect(v.blockers.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses when brand gating could not be checked', () => {
    // Unknown is not permission. A bulk action is the worst place to guess at approval: the answer
    // arrives later as a suppressed listing on a marketplace nobody was watching.
    const v = verdictFor(ok({ restricted: null }));
    expect(v.canList).toBe(false);
    expect(v.blockers.join(' ')).toMatch(/could not check/i);
  });

  it('refuses a channel Amazon has already gated', () => {
    expect(verdictFor(ok({ restricted: true })).canList).toBe(false);
  });

  it('never re-lists somewhere we already sell', () => {
    expect(verdictFor(ok({ alreadyListed: true })).canList).toBe(false);
  });

  it('refuses when the margin cannot be priced, and says why', () => {
    const v = verdictFor(ok({ priceCents: null, priceReason: 'No price reaches 20% margin on this marketplace' }));
    expect(v.canList).toBe(false);
    expect(v.blockers).toContain('No price reaches 20% margin on this marketplace');
  });

  it('refuses a price of zero as firmly as a missing one', () => {
    // Amazon would accept a zero price and sell the goods for nothing.
    expect(verdictFor(ok({ priceCents: 0 })).canList).toBe(false);
  });

  it('treats zero stock as a warning, not a blocker', () => {
    // "Listed but out of stock" is a real and deliberate state; missing stock is not.
    const v = verdictFor(ok({ quantity: 0 }));
    expect(v.canList).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/zero stock/i);
  });

  it('refuses when there is no handling time to use', () => {
    // Amazon requires it and there is no honest default to invent on someone's behalf.
    expect(verdictFor(ok({ handlingTimeDays: null })).canList).toBe(false);
  });

  it('warns about a brand restriction but still lists', () => {
    // The same rule as the single-listing flow. Blocking here and warning there would mean the two
    // paths disagree about what is allowed.
    const v = verdictFor(ok({ brandRestriction: 'Beurer has restricted sales on Amazon US' }));
    expect(v.canList).toBe(true);
    expect(v.warnings).toContain('Beurer has restricted sales on Amazon US');
  });

  it('refuses a product not permitted on the marketplace, quoting the reason', () => {
    const v = verdictFor(ok({ eligible: false, eligibilityReasons: ['230V product cannot be sold in the US'] }));
    expect(v.blockers).toContain('230V product cannot be sold in the US');
  });
});

describe('the one blocker a reader can clear on the spot', () => {
  it('flags a channel held up only by a missing handling time', () => {
    // The screen offers a box for exactly these. Every other blocker needs a trip somewhere else —
    // Amazon, the brand, the product record — and a box that cannot help is worse than none.
    const v = verdictFor(ok({ handlingTimeDays: null }));
    expect(v.canList).toBe(false);
    expect(v.blockedOnlyByHandlingTime).toBe(true);
  });

  it('does not flag one that has other problems too', () => {
    // Typing a handling time here fixes nothing, and offering the box would imply otherwise.
    const v = verdictFor(ok({ handlingTimeDays: null, asin: null }));
    expect(v.blockedOnlyByHandlingTime).toBe(false);
  });

  it('is false for a channel that is already fine', () => {
    expect(verdictFor(ok()).blockedOnlyByHandlingTime).toBe(false);
  });
});

describe('days to dispatch, as someone types it', () => {
  it('takes a normal figure', () => {
    expect(parseHandlingDays('2')).toEqual({ ok: true, days: 2 });
    expect(parseHandlingDays(5)).toEqual({ ok: true, days: 5 });
  });

  it('accepts zero, which means same-day dispatch', () => {
    // Unusual enough to accept deliberately rather than treat as an empty box.
    expect(parseHandlingDays(0)).toEqual({ ok: true, days: 0 });
  });

  it('refuses a fraction of a day', () => {
    // Amazon's field is an integer. Silently truncating 1.5 makes a different promise from the one
    // that was typed, and the customer is the one who finds out.
    expect(parseHandlingDays(1.5).ok).toBe(false);
  });

  it('refuses a negative, an empty box, and nonsense', () => {
    expect(parseHandlingDays(-1).ok).toBe(false);
    expect(parseHandlingDays('').ok).toBe(false);
    expect(parseHandlingDays(null).ok).toBe(false);
    expect(parseHandlingDays('soon').ok).toBe(false);
  });

  it('refuses a figure Amazon would not accept anyway', () => {
    expect(parseHandlingDays(31).ok).toBe(false);
    expect(parseHandlingDays(30).ok).toBe(true);
  });
});

describe('the profit percentage someone types', () => {
  it('takes a normal margin', () => {
    expect(parseMarginPct('20')).toEqual({ ok: true, marginPct: 20 });
    expect(parseMarginPct(12.5)).toEqual({ ok: true, marginPct: 12.5 });
  });

  it('refuses zero and below', () => {
    // Zero would list everything at breakeven across every marketplace at once.
    expect(parseMarginPct(0).ok).toBe(false);
    expect(parseMarginPct(-5).ok).toBe(false);
  });

  it('refuses a figure that is almost certainly a typo', () => {
    // 95 is a mistyped 9.5 far more often than it is a plan, and this button acts on many
    // marketplaces at once.
    expect(parseMarginPct(95).ok).toBe(false);
  });

  it('refuses anything that is not a number', () => {
    expect(parseMarginPct('').ok).toBe(false);
    expect(parseMarginPct('twenty').ok).toBe(false);
    expect(parseMarginPct(null).ok).toBe(false);
  });
});
