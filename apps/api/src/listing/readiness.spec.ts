import { describe, expect, it } from 'vitest';
import { checkBoost, evaluateReadiness, type ListingFacts } from './readiness';

const facts = (over: Partial<ListingFacts> = {}): ListingFacts => ({
  ean: '4006414100015',
  upc: null,
  ebayTitle: null,
  descriptionHtml: null,
  imageCount: 0,
  packageWeightKg: null,
  hasPackageDimensions: false,
  categoryRef: null,
  condition: 'NEW',
  handlingTimeDays: 2,
  deliveryTemplate: null,
  missingRequiredAspects: [],
  ...over,
});

describe('catalogue channels ask for very little', () => {
  it('is ready for Amazon on an identifier, a condition and a handling time', () => {
    const v = evaluateReadiness('amazon', facts());
    expect(v.ready).toBe(true);
    expect(v.missing).toHaveLength(0);
  });

  it('never asks Amazon for a title, description or image', () => {
    // Amazon shows its own catalogue copy, so demanding ours would be a made-up requirement.
    const v = evaluateReadiness('amazon', facts({ ebayTitle: null, descriptionHtml: null, imageCount: 0 }));
    expect(v.ready).toBe(true);
  });

  it('needs an identifier to find the catalogue entry at all', () => {
    const v = evaluateReadiness('amazon', facts({ ean: null, upc: null }));
    expect(v.ready).toBe(false);
    expect(v.missing.map((m) => m.key)).toContain('identifier');
  });

  it('accepts a UPC in place of an EAN', () => {
    expect(evaluateReadiness('amazon', facts({ ean: null, upc: '012345678905' })).ready).toBe(true);
  });

  it('treats whitespace as absent', () => {
    expect(evaluateReadiness('amazon', facts({ ean: '   ', upc: null })).ready).toBe(false);
  });

  it('asks OnBuy for a delivery template instead of a handling time', () => {
    const v = evaluateReadiness('onbuy', facts());
    expect(v.missing.map((m) => m.key)).toEqual(['deliveryTemplate']);
    expect(evaluateReadiness('onbuy', facts({ deliveryTemplate: 'standard-uk' })).ready).toBe(true);
  });
});

describe('eBay has to be given everything', () => {
  const complete = facts({
    ebayTitle: 'Fissler Original Profi Collection Frying Pan 24cm',
    descriptionHtml: '<p>Stainless steel frying pan.</p>',
    imageCount: 3,
    categoryRef: '20628',
    packageWeightKg: 1.4,
    hasPackageDimensions: true,
  });

  it('is ready only once title, description, image, category, aspects and package are all there', () => {
    expect(evaluateReadiness('ebay', complete).ready).toBe(true);
  });

  it('lists exactly what is missing, as things to go and do', () => {
    const v = evaluateReadiness('ebay', facts());
    expect(v.ready).toBe(false);
    expect(v.missing.map((m) => m.key)).toEqual(['ebayTitle', 'description', 'image', 'category', 'package']);
    expect(v.missing[0].label).toContain('80 characters');
  });

  it('counts required aspects that are still empty', () => {
    const v = evaluateReadiness('ebay', { ...complete, missingRequiredAspects: ['Brand', 'Material'] });
    expect(v.ready).toBe(false);
    expect(v.missing.map((m) => m.key)).toEqual(['aspects']);
  });

  it('reports progress, not just a verdict', () => {
    const v = evaluateReadiness('ebay', facts());
    expect(v.totalCount).toBe(7);
    expect(v.satisfiedCount).toBe(2); // condition and aspects
  });

  it('needs both weight and dimensions, not one of them', () => {
    expect(evaluateReadiness('ebay', { ...complete, hasPackageDimensions: false }).ready).toBe(false);
    expect(evaluateReadiness('ebay', { ...complete, packageWeightKg: 0 }).ready).toBe(false);
  });
});

describe('an unknown channel asks for nothing rather than crashing', () => {
  it('returns ready with no requirements', () => {
    const v = evaluateReadiness('etsy', facts());
    expect(v.ready).toBe(true);
    expect(v.totalCount).toBe(0);
  });
});

describe('boost ceiling', () => {
  it('allows zero, which is the default we always want', () => {
    expect(checkBoost(0, 0)).toEqual({ ok: true });
  });

  it("refuses OnBuy's own 20% default when the ceiling is zero", () => {
    const r = checkBoost(20, 0);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('capped at 0%');
  });

  it('allows a rate up to a raised ceiling and refuses above it', () => {
    expect(checkBoost(5, 10)).toEqual({ ok: true });
    expect(checkBoost(10, 10)).toEqual({ ok: true });
    expect(checkBoost(10.01, 10).ok).toBe(false);
  });

  it('refuses a negative or nonsense rate', () => {
    expect(checkBoost(-1, 10).ok).toBe(false);
    expect(checkBoost(Number.NaN, 10).ok).toBe(false);
  });
});
