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
  const base = { returnsRate: 0.05, returnsSource: 'sku' as const, storagePerUnitCents: 0, adCostPerUnitCents: 0 };

  it('a cost that does not apply is not an omission', () => {
    // FBM: nothing sits at Amazon, and MASQ runs no advertising. Counting either as missing would
    // block a low-margin strategy on a floor that is already complete.
    const c = describeCompleteness({ ...base, isFba: false, storageApplies: false, adsApply: false });
    expect(c.loaded).toBe(true);
    expect(c.omits).toEqual([]);
    expect(c.includes).toContain('outbound shipping');
  });

  it('storage is irrelevant on an FBM listing even where the marketplace has it enabled', () => {
    const c = describeCompleteness({ ...base, isFba: false, storageApplies: true, adsApply: false });
    expect(c.loaded).toBe(true);
  });

  it('an applicable cost with no value IS an omission', () => {
    const c = describeCompleteness({ ...base, isFba: true, storageApplies: true, adsApply: true });
    expect(c.omits).toEqual(['storage', 'advertising']);
    expect(c.loaded).toBe(false);
  });

  it('counts an applicable cost once it has a value', () => {
    const c = describeCompleteness({
      ...base, storagePerUnitCents: 12, adCostPerUnitCents: 40,
      isFba: true, storageApplies: true, adsApply: true,
    });
    expect(c.loaded).toBe(true);
    expect(c.includes).toEqual(expect.arrayContaining(['storage', 'advertising']));
  });

  it('still reports returns as missing when there are none — they always apply', () => {
    const c = describeCompleteness({ ...base, returnsRate: 0, isFba: false, storageApplies: false, adsApply: false });
    expect(c.omits).toEqual(['returns']);
  });
});
