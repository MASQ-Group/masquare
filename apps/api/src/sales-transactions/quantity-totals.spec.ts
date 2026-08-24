import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * Totalling quantities that arrive as Prisma Decimals.
 *
 * When the sales line quantity became DECIMAL, every total on the list turned into nonsense:
 * "0121111.250.21222020" where a number should have been. `+` on a Decimal concatenates strings —
 * 0 + 1 + 2 gives "012" — while `*` coerces numerically, which is why the money columns were fine
 * and only the counts broke. TypeScript could not see it because those reducers take `any`.
 *
 * These tests pin the behaviour rather than the fix: they fail against a naive sum, and pass only
 * when the value is coerced first.
 */

/** The coercion used across the sales and analytics services. */
const n = (v: unknown) => Number(v ?? 0);

const dec = (v: string) => new Prisma.Decimal(v);

describe('summing Decimal quantities', () => {
  it('adds whole quantities to a whole number', () => {
    const items = [{ quantity: dec('1') }, { quantity: dec('2') }, { quantity: dec('1') }];
    expect(items.reduce((s, i) => s + n(i.quantity), 0)).toBe(4);
  });

  it('adds fractional quantities to their true total', () => {
    const items = [{ quantity: dec('1') }, { quantity: dec('1.5') }, { quantity: dec('1.2') }];
    expect(items.reduce((s, i) => s + n(i.quantity), 0)).toBeCloseTo(3.7, 10);
  });

  it('demonstrates the bug this guards against', () => {
    const items = [{ quantity: dec('1') }, { quantity: dec('2') }];
    // The original code, preserved so the failure mode stays recognisable.
    const naive = items.reduce((s: any, i) => s + (i.quantity ?? 0), 0);
    expect(typeof naive).toBe('string');
    expect(naive).toBe('012');

    // And the same data, coerced.
    expect(items.reduce((s, i) => s + n(i.quantity), 0)).toBe(3);
  });

  it('treats a missing quantity as nothing rather than NaN', () => {
    const items = [{ quantity: dec('2') }, { quantity: null }, { quantity: undefined }];
    expect(items.reduce((s, i) => s + n(i.quantity), 0)).toBe(2);
  });

  it('keeps multiplication correct, which never broke', () => {
    // `*` coerces a Decimal numerically, so the money columns were always right — worth holding.
    const price = 10;
    expect(price * n(dec('1.5'))).toBe(15);
  });
});
