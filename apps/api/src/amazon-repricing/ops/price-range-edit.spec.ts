import { describe, expect, it } from 'vitest';
import { parseRangeRow, planRangeChange, type RangeRow } from './price-range-edit';

const NOW = new Date('2026-09-15T12:00:00Z');
const ROW: RangeRow = {
  breakevenCents: 2000, strategyFloorCents: 2300, minPriceCents: null, maxPriceCents: null, minMarginPct: null,
  clearanceFloorCents: null, clearanceReason: null, clearanceEndsAt: null, clearanceUntilStock: null,
};

describe('planRangeChange', () => {
  it('sets a fixed minimum and maximum', () => {
    const p = planRangeChange(ROW, { minPrice: { mode: 'fixed', value: 21 }, maxPrice: { mode: 'fixed', value: 39.99 } }, { now: NOW });
    expect(p.problems).toEqual([]);
    expect(p.data).toMatchObject({ minPriceCents: 2100, maxPriceCents: 3999 });
    expect(p.after).toMatchObject({ floorCents: 2100, floorSource: 'min_price', maxPriceCents: 3999 });
  });

  /** One figure rarely suits a whole brand, so bulk can work from each SKU's own breakeven. */
  it('sets prices as a percentage above each SKU’s breakeven', () => {
    const p = planRangeChange(ROW, { minPrice: { mode: 'above_breakeven_pct', value: 5 }, maxPrice: { mode: 'above_breakeven_pct', value: 60 } }, { now: NOW });
    expect(p.data).toMatchObject({ minPriceCents: 2100, maxPriceCents: 3200 });
  });

  it('refuses a percentage on a SKU with no breakeven, and changes nothing on it', () => {
    const p = planRangeChange({ ...ROW, breakevenCents: null }, { minPrice: { mode: 'above_breakeven_pct', value: 5 }, maxPrice: { mode: 'fixed', value: 30 } }, { now: NOW });
    expect(p.problems[0]).toContain('no breakeven');
    expect(p.data).toEqual({});
  });

  it('refuses a maximum below the minimum', () => {
    expect(planRangeChange(ROW, { minPrice: { mode: 'fixed', value: 30 }, maxPrice: { mode: 'fixed', value: 25 } }, { now: NOW }).problems)
      .toContain('Maximum price is below the minimum price');
  });

  /** A loss is only ever priced through clearance. */
  it('refuses a negative margin', () => {
    expect(planRangeChange(ROW, { minMarginPct: -5 }, { now: NOW }).problems[0]).toContain('only possible in clearance');
    expect(planRangeChange(ROW, { minMarginPct: 0 }, { now: NOW })).toMatchObject({ problems: [], marginChanged: true });
  });

  it('sets a clearance below breakeven with its reason, end and who set it', () => {
    const p = planRangeChange(ROW, {
      clearance: { mode: 'set', floor: { mode: 'above_breakeven_pct', value: -20 }, reason: 'Discontinued', endsAt: '2026-10-01T00:00:00Z', untilStock: 0 },
    }, { now: NOW, actorId: 'user-1' });
    expect(p.problems).toEqual([]);
    expect(p.data).toMatchObject({ clearanceFloorCents: 1600, clearanceReason: 'Discontinued', clearanceUntilStock: 0, clearanceSetById: 'user-1' });
    expect(p.after).toMatchObject({ floorSource: 'clearance', lowestAllowedCents: 1600 });
  });

  it('refuses a clearance with no end or no reason', () => {
    const p = planRangeChange(ROW, { clearance: { mode: 'set', floor: { mode: 'fixed', value: 15 }, reason: '', endsAt: null, untilStock: null } }, { now: NOW });
    expect(p.problems.join(' ')).toContain('why');
    expect(p.problems.join(' ')).toContain('an end');
  });

  it('clears a clearance', () => {
    const row = { ...ROW, clearanceFloorCents: 1600, clearanceReason: 'x', clearanceEndsAt: new Date('2026-10-01T00:00:00Z') };
    expect(planRangeChange(row, { clearance: { mode: 'clear' } }, { now: NOW }).data).toMatchObject({ clearanceFloorCents: null, clearanceReason: null });
  });

  it('reports no change when the values are already set', () => {
    expect(planRangeChange({ ...ROW, minPriceCents: 2100 }, { minPrice: { mode: 'fixed', value: 21 } }, { now: NOW })).toMatchObject({ changed: false, data: {} });
  });
});

describe('parseRangeRow', () => {
  const base = { SKU: 'IT68278', Marketplace: 'de' };

  it('leaves blank cells alone and clears on a dash', () => {
    const r = parseRangeRow({ ...base, 'Min price': '', 'Max price': '-', 'Margin %': '8%' });
    expect(r.change).toEqual({ maxPrice: { mode: 'clear' }, minMarginPct: 8 });
    expect(r.marketplace).toBe('DE');
  });

  it('reads prices written with a currency sign', () => {
    expect(parseRangeRow({ ...base, 'Min price': '€19,99' }).change.minPrice).toEqual({ mode: 'fixed', value: 19.99 });
    expect(parseRangeRow({ ...base, 'Max price': '1,299.00' }).change.maxPrice).toEqual({ mode: 'fixed', value: 1299 });
  });

  it('reads a clearance, running to the end of its date', () => {
    const r = parseRangeRow({ ...base, 'Clearance floor': '15.50', 'Clearance reason': 'Old model', 'Clearance ends': '2026-09-30', 'Clearance until stock': '0' });
    expect(r.problems).toEqual([]);
    expect(r.change.clearance).toEqual({ mode: 'set', floor: { mode: 'fixed', value: 15.5 }, reason: 'Old model', endsAt: '2026-10-01T00:00:00.000Z', untilStock: 0 });
  });

  it('names the cell that could not be read', () => {
    const r = parseRangeRow({ ...base, 'Min price': 'cheap', 'Clearance ends': '30/09/2026' });
    expect(r.problems).toEqual(['Min price: "cheap" is not a price', 'Clearance ends: "30/09/2026" is not a date as YYYY-MM-DD']);
  });
});
