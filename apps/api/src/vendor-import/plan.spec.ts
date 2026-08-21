import { describe, it, expect } from 'vitest';
import { buildPlan, summarisePlan, type PlanProduct } from './plan';

const product = (over: Partial<PlanProduct> = {}): PlanProduct => ({
  id: 'p1', mainSku: 'IT67017', title: 'Air cooler',
  purchaseCostAmount: 95, purchaseCostCurrency: 'EUR',
  mapAmount: 165, mapCurrency: 'EUR',
  ean: '5290000202404', upc: null, availability: 29, vatRatePct: 19,
  ...over,
});

const OPTS = { currency: 'EUR', mapIncludesVat: true, anomalyPct: 0.3 };
const planFor = (row: any, p = product(), opts = OPTS) =>
  buildPlan([{ productId: 'p1', ...row }], new Map([['p1', p]]), opts);

describe('only real differences become changes', () => {
  it('re-applying the same file proposes nothing', () => {
    const plan = planFor({ purchaseCost: '95', map: '165', availability: '29', ean: '5290000202404' });
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('records the previous value, which is what makes a run reversible', () => {
    const plan = planFor({ purchaseCost: '99' });
    expect(plan.changes[0]).toMatchObject({ field: 'purchaseCost', oldValue: '95 EUR', newValue: '99 EUR' });
  });

  it('sets a cost that was never recorded', () => {
    const plan = planFor({ purchaseCost: '99' }, product({ purchaseCostAmount: null }));
    expect(plan.changes[0].oldValue).toBeNull();
  });
});

describe('guards', () => {
  it('flags a cost that moves further than the threshold', () => {
    expect(planFor({ purchaseCost: '140' }).changes[0].warning).toBe('+47% vs current cost');
    expect(planFor({ purchaseCost: '100' }).changes[0].warning).toBeUndefined();
  });

  it('flags a change of currency rather than comparing across two', () => {
    const plan = planFor({ purchaseCost: '80' }, product(), { ...OPTS, currency: 'GBP' });
    expect(plan.changes[0].warning).toContain('currency changes from EUR to GBP');
  });

  it('skips a price cell that is not a price', () => {
    const plan = planFor({ purchaseCost: 'POA' });
    expect(plan.changes).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ field: 'purchaseCost', why: 'not a price' });
  });

  it('skips a fractional availability rather than rounding it', () => {
    expect(planFor({ availability: '3.5' }).skipped[0].field).toBe('availability');
  });
});

describe('MAP and VAT basis', () => {
  it('takes the vendor figure as-is when they quote gross', () => {
    expect(planFor({ map: '179' }).changes[0].newValue).toBe('179 EUR');
  });

  it('grosses up when the vendor quotes net', () => {
    const plan = planFor({ map: '100' }, product(), { ...OPTS, mapIncludesVat: false });
    expect(plan.changes[0].newValue).toBe('119 EUR');
    expect(plan.changes[0].warning).toBe('grossed up by 19% VAT');
  });

  it('refuses rather than storing a net figure as a shelf price', () => {
    // No VAT class means no rate to gross up with; writing the net value would understate MAP.
    const plan = planFor({ map: '100' }, product({ vatRatePct: null }), { ...OPTS, mapIncludesVat: false });
    expect(plan.changes).toEqual([]);
    expect(plan.skipped[0].why).toContain('no VAT class');
  });
});

describe('barcodes', () => {
  it('fills one we do not have', () => {
    const plan = planFor({ ean: '4211125659042' }, product({ ean: null }));
    expect(plan.changes[0]).toMatchObject({ field: 'ean', oldValue: null, newValue: '4211125659042' });
    expect(plan.changes[0].warning).toBeUndefined();
  });

  it('replaces one that disagrees, and says so', () => {
    const plan = planFor({ ean: '9312432024686' }, product({ ean: '9312432030144' }));
    expect(plan.changes[0]).toMatchObject({ field: 'ean', oldValue: '9312432030144', newValue: '9312432024686' });
    expect(plan.changes[0].warning).toContain('replaces a different barcode');
  });

  it('does not treat a UPC and its zero-padded EAN as different', () => {
    const plan = planFor({ ean: '012345678905' }, product({ ean: '012345678905', upc: null }));
    expect(plan.changes).toEqual([]);
  });

  it('files a 12-digit code as a UPC', () => {
    const plan = planFor({ ean: '012345678905' }, product({ ean: null, upc: null }));
    expect(plan.changes[0].field).toBe('upc');
  });
});

describe('summary', () => {
  it('counts by field and how many need a look', () => {
    const plan = buildPlan(
      [
        { productId: 'p1', purchaseCost: '200', availability: '5' },
        { productId: 'p2', purchaseCost: '96' },
      ],
      new Map([
        ['p1', product()],
        ['p2', product({ id: 'p2', mainSku: 'IT67018', purchaseCostAmount: 95, availability: 0, ean: null })],
      ]),
      OPTS,
    );
    const s = summarisePlan(plan);
    expect(s.byField.purchaseCost).toBe(2);
    expect(s.byField.availability).toBe(1);
    expect(s.warnings).toBe(1); // only the +111% one
    expect(s.total).toBe(3);
  });
});
