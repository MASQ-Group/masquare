import { describe, it, expect } from 'vitest';
import { resolveParams, canApplyPreset } from './resolve-preset';

const CLEAR_STOCK = {
  name: 'Clear stock', strategy: 'LOWEST_PRICE', minMarginPct: 2, probeStepPct: null,
  probeIntervalMinutes: null, fbmPremiumPct: 0, epsilonCents: 5, requiresLoadedFloor: true,
};
const BALANCED = {
  name: 'Balanced', strategy: 'BUY_BOX', minMarginPct: 12, probeStepPct: null,
  probeIntervalMinutes: null, fbmPremiumPct: null, epsilonCents: null, requiresLoadedFloor: false,
};

describe('resolving a SKU’s parameters', () => {
  it('falls back to the global default with no preset and no override', () => {
    const r = resolveParams({}, null);
    expect(r.minMarginPct).toBeCloseTo(0.12, 6);
    expect(r.marginFrom).toBe('default');
  });

  it('takes the preset when there is no per-SKU override', () => {
    const r = resolveParams({}, CLEAR_STOCK);
    expect(r.minMarginPct).toBeCloseTo(0.02, 6);
    expect(r.marginFrom).toBe('preset');
    expect(r.strategy).toBe('LOWEST_PRICE');
  });

  it('a per-SKU override beats the preset — it is how an exception is expressed', () => {
    const r = resolveParams({ minMarginPct: 30 }, CLEAR_STOCK);
    expect(r.minMarginPct).toBeCloseTo(0.30, 6);
    expect(r.marginFrom).toBe('sku');
    expect(r.presetName).toBe('Clear stock'); // still reported, so the combination is visible
  });

  it('mixes layers per field rather than choosing one wholesale', () => {
    const r = resolveParams({ epsilonCents: 50 }, CLEAR_STOCK);
    expect(r.epsilonCents).toBe(50); // from the SKU
    expect(r.minMarginPct).toBeCloseTo(0.02, 6); // from the preset
  });

  it('keeps a zero from a preset instead of treating it as absent', () => {
    expect(resolveParams({}, CLEAR_STOCK).fbmPremiumPct).toBe(0);
  });

  it('a SKU set to MANUAL_ONLY is not overridden by a preset', () => {
    expect(resolveParams({ strategy: 'MANUAL_ONLY' }, BALANCED).strategy).toBe('MANUAL_ONLY');
  });
});

describe('refusing an aggressive preset on an unloaded floor', () => {
  it('refuses when the floor omits costs', () => {
    const v = canApplyPreset(CLEAR_STOCK, { floorOmits: ['storage', 'advertising'] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('storage, advertising');
  });

  it('allows it once the floor is loaded', () => {
    expect(canApplyPreset(CLEAR_STOCK, { floorOmits: [] }).ok).toBe(true);
  });

  it('lets a conservative preset onto any floor', () => {
    // At 12% the omissions hide inside the margin, so they are not a reason to block.
    expect(canApplyPreset(BALANCED, { floorOmits: ['storage', 'advertising'] }).ok).toBe(true);
  });
});
