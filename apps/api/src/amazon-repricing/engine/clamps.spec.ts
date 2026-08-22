import { describe, it, expect } from 'vitest';
import { applyClamps, ClampBounds } from './clamps';

const base: ClampBounds = {
  strategyFloorCents: 1500,
  breakevenCents: 1300,
  maxPriceCents: 3000,
  fairPricingCeilingCents: 2800,
  amazonMinAllowedCents: 1400,
  amazonMaxAllowedCents: 3200,
};

function priceOf(r: ReturnType<typeof applyClamps>): number {
  if (!r.ok) throw new Error('expected clamp to succeed');
  return r.priceCents;
}

describe('applyClamps', () => {
  it('leaves an in-range target untouched but records every clamp as non-binding', () => {
    const r = applyClamps(2000, base);
    expect(priceOf(r)).toBe(2000);
    if (r.ok) expect(r.steps.every((s) => !s.bound)).toBe(true);
  });

  it('raises a sub-floor target up to the strategy floor', () => {
    const r = applyClamps(1000, base);
    expect(priceOf(r)).toBe(1500);
    if (r.ok) expect(r.steps.find((s) => s.clamp === 'STRATEGY_FLOOR')?.bound).toBe(true);
  });

  it('caps an over-max target at the fair-pricing ceiling (tighter than business max)', () => {
    const r = applyClamps(5000, base);
    expect(priceOf(r)).toBe(2800); // fair-pricing ceiling binds before business max is reached
    if (r.ok) expect(r.steps.find((s) => s.clamp === 'FAIR_PRICING_CEILING')?.bound).toBe(true);
  });

  it('MAP raises the target above the strategy floor when higher', () => {
    const r = applyClamps(1000, { ...base, mapCents: 1800 });
    expect(priceOf(r)).toBe(1800);
  });

  it('applies clamps in the fixed documented order', () => {
    const r = applyClamps(2000, { ...base, mapCents: 1600 });
    if (!r.ok) throw new Error('expected ok');
    expect(r.steps.map((s) => s.clamp)).toEqual([
      'MAP',
      'STRATEGY_FLOOR',
      'BUSINESS_MAX',
      'FAIR_PRICING_CEILING',
      'AMAZON_MIN_MAX',
    ]);
  });

  it('clamps into the Amazon allowed band as the final backstop', () => {
    const r = applyClamps(1450, { strategyFloorCents: 1000, breakevenCents: 900, amazonMinAllowedCents: 1400, amazonMaxAllowedCents: 1500 });
    expect(priceOf(r)).toBe(1450);
    const low = applyClamps(1000, { strategyFloorCents: 900, breakevenCents: 800, amazonMinAllowedCents: 1400, amazonMaxAllowedCents: 1500 });
    expect(priceOf(low)).toBe(1400); // raised to amazon min
  });

  it('quarantines (does not price) when the strategy floor exceeds a ceiling', () => {
    const r = applyClamps(2000, { ...base, strategyFloorCents: 3000, fairPricingCeilingCents: 2500 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toMatch(/strategyFloor/);
  });

  it('quarantines when MAP is above the business max', () => {
    const r = applyClamps(2000, { strategyFloorCents: 4000, breakevenCents: 1000, mapCents: 3500, maxPriceCents: 3000 });
    expect(r.ok).toBe(false);
  });

  it('works with only the mandatory strategy floor set (optional bounds omitted)', () => {
    const r = applyClamps(1200, { strategyFloorCents: 1500, breakevenCents: 1300 });
    expect(priceOf(r)).toBe(1500);
    if (r.ok) expect(r.steps.map((s) => s.clamp)).toEqual(['STRATEGY_FLOOR']);
  });
});

// MAP is a MINIMUM advertised price, so a strategy floor above it is the ordinary case: we price
// at the higher of the two. Treating it as a ceiling quarantined SKUs for being more profitable
// than their MAP, and would have hit every listing once MAP values were populated.
describe('MAP is a floor, not a ceiling', () => {
  const base = { strategyFloorCents: 5000, breakevenCents: 4000 };

  it('does not quarantine when the floor is above MAP', () => {
    const r = applyClamps(4500, { ...base, mapCents: 3000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.priceCents).toBe(5000); // lifted to the floor, the higher of the two
  });

  it('lifts to MAP when MAP is the higher of the two', () => {
    const r = applyClamps(4500, { ...base, mapCents: 6000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.priceCents).toBe(6000);
  });

  it('still quarantines on a genuine ceiling conflict', () => {
    const r = applyClamps(4500, { ...base, amazonMaxAllowedCents: 4000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toContain('amazonMaxAllowed');
  });
});
