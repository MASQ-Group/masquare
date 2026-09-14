import { describe, expect, it } from 'vitest';
import { profitAt, suggestPrice, type EbayCostInputs } from './ebay-pricing';

/** eBay UK as it stands: 12.8% of the buyer's total plus 30p an order, on 20% VAT. */
const UK: EbayCostInputs = { costCents: 1500, vatRate: 0.2, feePct: 0.128, fixedFeeCents: 30 };

describe('profitAt', () => {
  it('takes VAT out before counting profit', () => {
    const out = profitAt(3000, { ...UK, feePct: 0, fixedFeeCents: 0 });
    expect(out.vatCents).toBe(500); // £30 gross is £25 net
    expect(out.profitCents).toBe(1000); // £25 − £15 cost
    expect(out.marginPct).toBe(40); // £10 of £25
  });

  it('charges the fee on the whole amount the buyer pays, plus the fixed fee', () => {
    const out = profitAt(3000, UK);
    expect(out.feesCents).toBe(Math.round(3000 * 0.128) + 30); // 384 + 30
    expect(out.profitCents).toBe(2500 - 414 - 1500);
  });

  it('reports a loss as a loss rather than clamping at zero', () => {
    const out = profitAt(1200, UK);
    expect(out.profitCents).toBeLessThan(0);
    expect(out.marginPct).toBeLessThan(0);
  });

  it('is safe at a price of nothing', () => {
    expect(profitAt(0, UK).marginPct).toBe(0);
  });
});

describe('suggestPrice', () => {
  it('finds the price that actually earns the margin asked for', () => {
    const s = suggestPrice(UK, 20);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    // The real test: feed the answer back through and the margin comes out at the target...
    expect(profitAt(s.outcome.priceCents, UK).marginPct).toBeGreaterThanOrEqual(20);
    // ...without overshooting it, which is what makes it the lowest price that qualifies. Checked as
    // a band rather than against a penny less, because marginPct is rounded to a tenth and a single
    // penny does not move it.
    expect(profitAt(s.outcome.priceCents, UK).marginPct).toBeLessThan(21);
    // A penny less genuinely earns less, so the figure is not sitting on a plateau.
    expect(profitAt(s.outcome.priceCents - 1, UK).profitCents)
      .toBeLessThan(profitAt(s.outcome.priceCents, UK).profitCents);
  });

  it('works at other margins, including none at all', () => {
    for (const target of [0, 5, 20, 35, 50]) {
      const s = suggestPrice(UK, target);
      expect(s.ok).toBe(true);
      if (s.ok) expect(profitAt(s.outcome.priceCents, UK).marginPct).toBeGreaterThanOrEqual(target);
    }
  });

  it('costs more to buy means more to sell', () => {
    const cheap = suggestPrice({ ...UK, costCents: 1000 }, 20);
    const dear = suggestPrice({ ...UK, costCents: 5000 }, 20);
    expect(cheap.ok && dear.ok && dear.outcome.priceCents > cheap.outcome.priceCents).toBe(true);
  });

  /** The bracket in the solution can reach zero; a huge number would be worse than an explanation. */
  it('refuses when fees and VAT leave nothing for the margin', () => {
    const s = suggestPrice({ ...UK, feePct: 0.9 }, 20);
    expect(s.ok).toBe(false);
    expect(!s.ok && s.reason).toContain('no price reaches it');
  });

  it('refuses a margin of 100% or more, which no price satisfies', () => {
    expect(suggestPrice(UK, 100).ok).toBe(false);
    expect(suggestPrice(UK, 150).ok).toBe(false);
  });

  it('refuses when the cost is not known', () => {
    const s = suggestPrice({ ...UK, costCents: -1 }, 20);
    expect(!s.ok && s.reason).toContain('cost is not known');
  });
});
