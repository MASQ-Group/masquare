import { describe, expect, it } from 'vitest';
import { profitEntry } from './listing-price';

describe('a price’s profit for the Edit price window', () => {
  it('states profit in the listing’s currency, converted at the rate the economics used', () => {
    // £35.38 was worth €41.75 → 1.18 €/£; €8.24 profit is £6.98.
    expect(profitEntry(3538, { profitEur: 8.24, marginPct: 19.7, priceEur: 41.75 })).toEqual({
      priceCents: 3538, profitCents: 698, profitEurCents: 824, marginPct: 19.7, aboveBreakeven: true,
    });
  });

  it('marks a loss as below breakeven', () => {
    expect(profitEntry(1000, { profitEur: -2.5, marginPct: -21.2, priceEur: 11.8 })?.aboveBreakeven).toBe(false);
  });

  it('is nothing where the economics could not be worked out', () => {
    expect(profitEntry(1000, undefined)).toBeNull();
    expect(profitEntry(1000, { profitEur: null, marginPct: null, priceEur: 11.8 })).toBeNull();
  });
});
