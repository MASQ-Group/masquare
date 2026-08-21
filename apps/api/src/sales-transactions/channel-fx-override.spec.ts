import { describe, it, expect } from 'vitest';

// A channel that converts at its own rate and pays out in EUR is not described by any market rate.
// eBay's rate on order 26-15031-86756 was 0.82974 against our 0.85609 — a 3.2% gap that overstated
// that order's profit by 7.4%. Where the channel's real rate is known, it is what the money
// actually converted at.
function rateForChannel(channel: { fxRateOverride?: number | null } | null, currency: string | null, marketRate: number | null): number | null {
  if (!currency || currency.toUpperCase() === 'EUR') return currency ? 1 : marketRate;
  const override = channel?.fxRateOverride != null ? Number(channel.fxRateOverride) : null;
  if (override != null && override > 0) return override;
  return marketRate;
}

describe('per-channel exchange rate', () => {
  const EBAY_US = { fxRateOverride: 0.82974 };
  const AMAZON = { fxRateOverride: null };

  it('uses the channel rate over the market rate', () => {
    expect(rateForChannel(EBAY_US, 'USD', 0.85609)).toBe(0.82974);
  });

  it('leaves channels without one on the market rate', () => {
    expect(rateForChannel(AMAZON, 'USD', 0.85609)).toBe(0.85609);
    expect(rateForChannel(null, 'USD', 0.85609)).toBe(0.85609);
  });

  it('ignores a zero or negative rate rather than wiping out revenue', () => {
    expect(rateForChannel({ fxRateOverride: 0 }, 'USD', 0.85609)).toBe(0.85609);
    expect(rateForChannel({ fxRateOverride: -1 }, 'USD', 0.85609)).toBe(0.85609);
  });

  it('never applies to EUR, where there is nothing to convert', () => {
    expect(rateForChannel({ fxRateOverride: 0.5 }, 'EUR', 1)).toBe(1);
  });

  it('reproduces the measured order', () => {
    const gross = 1398.14;
    const fee = 238.4; // eBay reports the fee in the ORDER currency, so the rate moves both sides
    const net = gross - fee;
    // Working from the rounded figures on eBay's own statement gives 30.53; from the unrounded
    // rate it is 30.56. The three cents are display rounding, not a difference in the model.
    expect(Number((net * (0.85609 - 0.82974)).toFixed(2))).toBe(30.56);
    // What eBay actually paid out, to within their rounding.
    expect(net * 0.82974).toBeCloseTo(962.31, 1);
  });
});
