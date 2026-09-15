import { describe, expect, it } from 'vitest';
import { bulkPriceFor, clearanceState, resolvePriceRange, validateClearance } from './price-range';

const NOW = new Date('2026-09-15T12:00:00Z');
const LATER = new Date('2026-10-01T00:00:00Z');
const EARLIER = new Date('2026-09-01T00:00:00Z');
const BASE = { breakevenCents: 2000, marginFloorCents: 2300, now: NOW };

describe('resolvePriceRange — the floor', () => {
  it('uses the margin floor when nothing else is set', () => {
    expect(resolvePriceRange(BASE)).toMatchObject({ floorCents: 2300, floorSource: 'margin', lowestAllowedCents: 2000 });
  });

  it('uses a minimum price in place of the margin floor, lower or higher', () => {
    expect(resolvePriceRange({ ...BASE, minPriceCents: 2100 })).toMatchObject({ floorCents: 2100, floorSource: 'min_price' });
    expect(resolvePriceRange({ ...BASE, minPriceCents: 2900 })).toMatchObject({ floorCents: 2900, floorSource: 'min_price' });
  });

  /** A typed minimum must not become a loss when fees or cost rise underneath it. */
  it('raises a minimum price below breakeven to breakeven, and says so', () => {
    const r = resolvePriceRange({ ...BASE, minPriceCents: 1500 });
    expect(r.floorCents).toBe(2000);
    expect(r.lowestAllowedCents).toBe(2000);
    expect(r.notes[0]).toContain('below breakeven');
  });

  it('lets an active clearance go below breakeven, and lowers the safety line with it', () => {
    const r = resolvePriceRange({ ...BASE, minPriceCents: 2500, clearance: { floorCents: 1600, reason: 'Old stock', endsAt: LATER, untilStock: null } });
    expect(r).toMatchObject({ floorCents: 1600, floorSource: 'clearance', lowestAllowedCents: 1600, clearanceActive: true });
    expect(r.notes[0]).toContain('4.00 below breakeven');
  });

  it('returns to the normal floor once clearance has ended', () => {
    const r = resolvePriceRange({ ...BASE, clearance: { floorCents: 1600, reason: 'Old stock', endsAt: EARLIER, untilStock: null } });
    expect(r).toMatchObject({ floorCents: 2300, floorSource: 'margin', lowestAllowedCents: 2000, clearanceActive: false, clearanceInactiveBecause: 'ended' });
  });

  it('warns when the maximum is below the floor', () => {
    expect(resolvePriceRange({ ...BASE, maxPriceCents: 2200 }).notes[0]).toContain('below the floor');
  });
});

describe('clearanceState', () => {
  const c = { floorCents: 1600, reason: 'x', endsAt: null, untilStock: 2 };

  it('ends once stock falls to the level set', () => {
    expect(clearanceState(c, NOW, 3)).toEqual({ active: true, because: null });
    expect(clearanceState(c, NOW, 2)).toEqual({ active: false, because: 'stock_reached' });
  });

  /** A clearance with no end would be a permanent licence to sell at a loss. */
  it('is never active without an end', () => {
    expect(clearanceState({ ...c, untilStock: null }, NOW, 10)).toEqual({ active: false, because: 'no_end' });
  });

  it('stays on while stock is unknown, until its date', () => {
    expect(clearanceState({ ...c, endsAt: LATER }, NOW, null).active).toBe(true);
  });
});

describe('validateClearance', () => {
  it('accepts a complete clearance', () => {
    expect(validateClearance({ floorCents: 1500, reason: 'Discontinued', endsAt: LATER, untilStock: null }, NOW)).toEqual([]);
  });

  it('needs a reason, an end in the future and a real floor', () => {
    const p = validateClearance({ floorCents: 0, reason: ' ', endsAt: null, untilStock: null }, NOW);
    expect(p).toHaveLength(3);
    expect(validateClearance({ floorCents: 1500, reason: 'x', endsAt: EARLIER, untilStock: null }, NOW)[0]).toContain('future');
  });
});

describe('bulkPriceFor', () => {
  it('sets a fixed price in cents', () => {
    expect(bulkPriceFor('fixed', 19.99, 1500)).toBe(1999);
  });

  it('sets a percentage above each SKU’s own breakeven', () => {
    expect(bulkPriceFor('above_breakeven_pct', 25, 2000)).toBe(2500);
    expect(bulkPriceFor('above_breakeven_pct', 0, 2000)).toBe(2000);
  });

  it('skips a percentage where there is no breakeven to take it from', () => {
    expect(bulkPriceFor('above_breakeven_pct', 25, null)).toBeNull();
  });

  it('refuses a fixed price of zero or less', () => {
    expect(bulkPriceFor('fixed', 0, 2000)).toBeNull();
  });
});
