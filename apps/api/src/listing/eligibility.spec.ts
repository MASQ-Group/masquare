import { describe, expect, it } from 'vitest';
import { evaluateEligibility, type MarketProfile, type ProductTechnical } from './eligibility';

const market = (over: Partial<MarketProfile> = {}): MarketProfile => ({
  channelType: 'amazon',
  marketplace: 'UK',
  label: 'Amazon UK',
  mainsVoltageMinV: 220,
  mainsVoltageMaxV: 240,
  mainsFrequencyHz: '50',
  plugTypes: ['G'],
  allowBatteries: true,
  allowHazmat: true,
  active: true,
  ...over,
});

const US = market({ marketplace: 'US', label: 'Amazon US', mainsVoltageMinV: 110, mainsVoltageMaxV: 127, mainsFrequencyHz: '60', plugTypes: ['A', 'B'] });
const JP = market({ marketplace: 'JP', label: 'Amazon JP', mainsVoltageMinV: 100, mainsVoltageMaxV: 100, mainsFrequencyHz: '50/60', plugTypes: ['A', 'B'] });

const product = (over: Partial<ProductTechnical> = {}): ProductTechnical => ({
  voltageMinV: null,
  voltageMaxV: null,
  frequencyHz: null,
  plugType: null,
  batteryRequired: null,
  hazmatClass: null,
  ...over,
});

describe('voltage', () => {
  it('blocks a 230V appliance on US mains — the case that started this', () => {
    const v = evaluateEligibility(product({ voltageMinV: 220, voltageMaxV: 240 }), US);
    expect(v.eligible).toBe(false);
    expect(v.findings).toContainEqual(
      expect.objectContaining({ code: 'VOLTAGE', severity: 'block' }),
    );
    expect(v.findings[0].reason).toContain('220-240');
    expect(v.findings[0].reason).toContain('110-127');
  });

  it('blocks the same appliance on Japanese mains', () => {
    expect(evaluateEligibility(product({ voltageMinV: 220, voltageMaxV: 240 }), JP).eligible).toBe(false);
  });

  it('allows it at home', () => {
    const v = evaluateEligibility(product({ voltageMinV: 220, voltageMaxV: 240 }), market());
    expect(v.eligible).toBe(true);
    expect(v.findings).toHaveLength(0);
  });

  it('allows a universal 100-240V supply everywhere', () => {
    const universal = product({ voltageMinV: 100, voltageMaxV: 240 });
    expect(evaluateEligibility(universal, US).eligible).toBe(true);
    expect(evaluateEligibility(universal, JP).eligible).toBe(true);
    expect(evaluateEligibility(universal, market()).eligible).toBe(true);
  });

  it('treats a single stated voltage as a range of one', () => {
    // "230V" recorded with only a minimum must not block a 220-240V market on a technicality.
    const v = evaluateEligibility(product({ voltageMinV: 230, voltageMaxV: null }), market());
    expect(v.eligible).toBe(true);
    expect(evaluateEligibility(product({ voltageMinV: null, voltageMaxV: 230 }), US).eligible).toBe(false);
  });

  it('reports an unstated voltage as unchecked, never as cleared', () => {
    const v = evaluateEligibility(product(), US);
    expect(v.eligible).toBe(true);
    expect(v.unchecked).toContain('VOLTAGE');
    expect(v.findings).toHaveLength(0);
  });

  it('ignores nonsense figures rather than blocking on them', () => {
    const v = evaluateEligibility(product({ voltageMinV: 0, voltageMaxV: 0 }), US);
    expect(v.unchecked).toContain('VOLTAGE');
  });
});

describe('plug type', () => {
  it('warns but does not block on a mismatch — an adapter exists', () => {
    const v = evaluateEligibility(product({ voltageMinV: 220, voltageMaxV: 240, plugType: 'G' }), market({ marketplace: 'DE', label: 'Amazon DE', plugTypes: ['F', 'C'] }));
    expect(v.eligible).toBe(true);
    expect(v.findings).toContainEqual(expect.objectContaining({ code: 'PLUG', severity: 'warn' }));
  });

  it('accepts a matching plug in any case', () => {
    const v = evaluateEligibility(product({ plugType: 'g' }), market());
    expect(v.findings).toHaveLength(0);
  });
});

describe('frequency', () => {
  it('warns when a 50Hz-only product meets 60Hz mains', () => {
    const v = evaluateEligibility(product({ voltageMinV: 100, voltageMaxV: 240, frequencyHz: '50' }), US);
    expect(v.eligible).toBe(true);
    expect(v.findings).toContainEqual(expect.objectContaining({ code: 'FREQUENCY', severity: 'warn' }));
  });

  it('says nothing when the product handles both', () => {
    const v = evaluateEligibility(product({ voltageMinV: 100, voltageMaxV: 240, frequencyHz: '50/60' }), US);
    expect(v.findings).toHaveLength(0);
  });
});

describe('batteries and dangerous goods', () => {
  it('blocks a battery product where batteries are not accepted', () => {
    const v = evaluateEligibility(product({ batteryRequired: true }), market({ allowBatteries: false }));
    expect(v.eligible).toBe(false);
    expect(v.findings[0].code).toBe('BATTERY');
  });

  it('does not block when the product explicitly needs no battery', () => {
    expect(evaluateEligibility(product({ batteryRequired: false }), market({ allowBatteries: false })).eligible).toBe(true);
  });

  it('blocks a hazmat product where hazmat is not accepted', () => {
    const v = evaluateEligibility(product({ hazmatClass: 'UN3481' }), market({ allowHazmat: false }));
    expect(v.eligible).toBe(false);
    expect(v.findings[0].reason).toContain('UN3481');
  });
});

describe('several problems at once', () => {
  it('reports every finding, and blocks if any one of them blocks', () => {
    const v = evaluateEligibility(
      product({ voltageMinV: 230, voltageMaxV: 230, frequencyHz: '50', plugType: 'G', batteryRequired: true }),
      market({ ...US, allowBatteries: false }),
    );
    expect(v.eligible).toBe(false);
    expect(v.findings.map((f) => f.code).sort()).toEqual(['BATTERY', 'FREQUENCY', 'PLUG', 'VOLTAGE']);
    expect(v.findings.filter((f) => f.severity === 'block').map((f) => f.code).sort()).toEqual(['BATTERY', 'VOLTAGE']);
  });
});
