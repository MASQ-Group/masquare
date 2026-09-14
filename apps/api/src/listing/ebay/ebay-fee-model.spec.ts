import { describe, expect, it } from 'vitest';
import { fitFeeModel, MIN_ORDERS, type SettledOrder } from './ebay-fee-model';

/**
 * Orders charged at a known rate, so the test can check the rate comes back out. Prices are spread
 * the way a real catalogue's are — a flat spread would make the fixed fee unmeasurable.
 */
function ordersAt(feePct: number, fixedCents: number, n = 60, noiseCents = 0): SettledOrder[] {
  return Array.from({ length: n }, (_, i) => {
    const grossCents = 500 + i * 137; // £5 → £85, deliberately uneven
    // Alternating noise so it cancels out rather than shifting the line.
    const noise = noiseCents ? (i % 2 ? noiseCents : -noiseCents) : 0;
    return { grossCents, feeCents: Math.round(grossCents * feePct + fixedCents + noise) };
  });
}

describe('fitFeeModel', () => {
  it('recovers the rate and the fixed fee from clean orders', () => {
    const m = fitFeeModel(ordersAt(0.128, 30));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.feePct).toBeCloseTo(0.128, 3);
    expect(m.fixedFeeCents).toBe(30);
    expect(m.sampleSize).toBe(60);
    expect(m.fit).toBeGreaterThan(0.99);
  });

  /** Real settlements are never exact — rounding, postage, the odd adjustment. */
  it('still recovers the rate through noise', () => {
    const m = fitFeeModel(ordersAt(0.128, 30, 80, 12));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.feePct).toBeCloseTo(0.128, 2);
    expect(Math.abs(m.fixedFeeCents - 30)).toBeLessThan(15);
  });

  it('measures a different account at a different rate', () => {
    const m = fitFeeModel(ordersAt(0.09, 0));
    expect(m.ok && m.feePct).toBeCloseTo(0.09, 3);
  });

  /** A flat percentage with no per-order fee: the honest answer is zero, not a negative. */
  it('holds the fixed fee at zero rather than reporting a negative one', () => {
    const m = fitFeeModel(ordersAt(0.128, 0, 60, 8));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.fixedFeeCents).toBe(0);
    expect(m.feePct).toBeCloseTo(0.128, 2);
  });
});

/**
 * Every refusal here is a case where believing the number would mispricing a whole catalogue in one
 * direction. Falling back to the published rate is the cheaper mistake.
 */
describe('fitFeeModel — when it refuses to guess', () => {
  it('refuses on too few orders', () => {
    const m = fitFeeModel(ordersAt(0.128, 30, MIN_ORDERS - 1));
    expect(m.ok).toBe(false);
    expect(!m.ok && m.reason).toContain(`at least ${MIN_ORDERS}`);
  });

  it('refuses when every order is the same size', () => {
    const same = Array.from({ length: 50 }, () => ({ grossCents: 2000, feeCents: 286 }));
    const m = fitFeeModel(same);
    expect(!m.ok && m.reason).toContain('cannot be told apart');
  });

  it('refuses a rate no marketplace charges', () => {
    expect(fitFeeModel(ordersAt(0.6, 0)).ok).toBe(false);
    expect(fitFeeModel(ordersAt(0.001, 0)).ok).toBe(false);
  });

  it('refuses an implausible fixed fee', () => {
    const m = fitFeeModel(ordersAt(0.1, 900));
    expect(!m.ok && m.reason).toContain('too high to believe');
  });

  it('refuses when the fees do not follow one rate', () => {
    // Fees scattered at random bear no relation to the order total.
    const scattered = Array.from({ length: 60 }, (_, i) => ({
      grossCents: 500 + i * 137,
      feeCents: 100 + ((i * 7919) % 900),
    }));
    const m = fitFeeModel(scattered);
    expect(m.ok).toBe(false);
    expect(!m.ok && m.reason).toContain('do not follow a single rate');
  });

  it('ignores refunds and impossible rows rather than fitting to them', () => {
    const good = ordersAt(0.128, 30);
    const polluted: SettledOrder[] = [
      ...good,
      { grossCents: 2000, feeCents: 0 }, // fee refunded
      { grossCents: 0, feeCents: 50 }, // cancelled
      { grossCents: 2000, feeCents: -260 }, // a credit
      { grossCents: 2000, feeCents: 5000 }, // fee larger than the order
      { grossCents: Number.NaN, feeCents: 10 },
    ];
    const m = fitFeeModel(polluted);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.sampleSize).toBe(good.length);
    expect(m.feePct).toBeCloseTo(0.128, 3);
  });

  it('counts only usable orders when saying there are too few', () => {
    const m = fitFeeModel([...ordersAt(0.128, 30, 5), ...Array.from({ length: 40 }, () => ({ grossCents: 1000, feeCents: 0 }))]);
    expect(!m.ok && m.sampleSize).toBe(5);
  });

  it('is safe on nothing at all', () => {
    expect(fitFeeModel([]).ok).toBe(false);
  });
});
