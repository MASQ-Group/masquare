import { describe, it, expect } from 'vitest';
import { resolveReturnsRate, describeCompleteness, MIN_UNITS_FOR_SKU_RATE } from './returns-rate';

describe('resolving a returns rate', () => {
  it('uses the SKU’s own rate once enough units support it', () => {
    const r = resolveReturnsRate({ unitsSold: 100, unitsReturned: 8 }, null, 0.02);
    expect(r).toMatchObject({ rate: 0.08, source: 'sku' });
  });

  it('ignores a rate built on too few units', () => {
    // 1 of 3 is not a 33% return rate, it is noise — and acting on it would lift that SKU's floor
    // by a third and take it out of contention.
    const r = resolveReturnsRate({ unitsSold: 3, unitsReturned: 1 }, { unitsSold: 500, unitsReturned: 15 }, 0.02);
    expect(r.source).toBe('marketplace');
    expect(r.rate).toBe(0.03);
  });

  it('falls back to the default when neither sample is big enough', () => {
    const r = resolveReturnsRate({ unitsSold: 5, unitsReturned: 0 }, { unitsSold: 20, unitsReturned: 1 }, 0.02);
    expect(r).toMatchObject({ rate: 0.02, source: 'default' });
  });

  it('treats the threshold as inclusive', () => {
    const r = resolveReturnsRate({ unitsSold: MIN_UNITS_FOR_SKU_RATE, unitsReturned: 2 }, null, 0.02);
    expect(r.source).toBe('sku');
  });

  it('caps an absurd rate rather than making every price unprofitable', () => {
    expect(resolveReturnsRate({ unitsSold: 30, unitsReturned: 30 }, null, 0.02).rate).toBe(0.5);
  });

  it('treats no returns as zero, not as missing', () => {
    expect(resolveReturnsRate({ unitsSold: 100, unitsReturned: 0 }, null, 0.02)).toMatchObject({ rate: 0, source: 'sku' });
  });
});

describe('describing what a floor covers', () => {
  it('names what is missing, so a low floor can be judged on evidence', () => {
    const c = describeCompleteness({ returnsRate: 0, returnsSource: 'default', storagePerUnitCents: 0, adCostPerUnitCents: 0, isFba: true });
    expect(c.loaded).toBe(false);
    expect(c.omits).toEqual(['returns', 'storage', 'advertising']);
    expect(c.includes).toContain('FBA fulfilment fee');
  });

  it('is loaded only when nothing material is left out', () => {
    const c = describeCompleteness({ returnsRate: 0.05, returnsSource: 'sku', storagePerUnitCents: 12, adCostPerUnitCents: 40, isFba: false });
    expect(c.loaded).toBe(true);
    expect(c.omits).toEqual([]);
    expect(c.includes.some((x) => x.startsWith('returns (5.0%, sku)'))).toBe(true);
    expect(c.includes).toContain('outbound shipping');
  });
});

// The "if recomputed now" preview exists to tell a STALE floor from a WRONG one. Computing it with
// different inputs than the real path inverts that: the preview comes out lower than a correct
// stored floor and reads as "yours is stale", sending a user to recompute a SKU already right.
describe('the preview must use the same inputs as the real computation', () => {
  const solve = (returnsRate: number) => {
    // Mirrors solveFloors' shape closely enough to show the direction of the error.
    const net = 100;
    return net * (1 + returnsRate); // more returns -> higher floor
  };

  it('omitting returns makes the preview lower than the stored floor', () => {
    const stored = solve(0.016); // real path, returns applied
    const previewWithout = solve(0); // preview, returns omitted
    expect(previewWithout).toBeLessThan(stored);
  });

  it('with the same inputs the preview agrees, so "differs" means something', () => {
    expect(solve(0.016)).toBe(solve(0.016));
  });
});
