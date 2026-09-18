import { describe, expect, it } from 'vitest';
import { MAX_ZEROING_LISTINGS, zeroingVerdict } from './zeroing-guard';

/** `n` listings spread across `products` products, as a real catalogue would be. */
const spread = (products: number, perProduct: number) =>
  Array.from({ length: products * perProduct }, (_, i) => ({ productId: `p${Math.floor(i / perProduct)}` }));

describe('what the guard counts', () => {
  it('lets a sold-out product empty every listing it has', () => {
    // The case that blocked production for seven days: two products, 45 listings between them.
    const candidates = [...spread(1, 11), ...spread(1, 34).map((c) => ({ productId: `x${c.productId}` }))];
    const verdict = zeroingVerdict(candidates, 25);
    expect(verdict.ok).toBe(true);
    expect(verdict.listings).toBe(45);
    expect(verdict.products).toBe(2);
  });

  it('still refuses the shape of the August incident', () => {
    // Roughly 1,900 listings, and the breadth that goes with it: most of the catalogue at once.
    const verdict = zeroingVerdict(spread(600, 3), 25);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain('600 products');
  });

  it('refuses on products, not on listings', () => {
    // 26 products with one listing each is refused; one product with 400 is not. The first is an
    // incident, the second is a product that sells everywhere.
    expect(zeroingVerdict(spread(26, 1), 25).ok).toBe(false);
    expect(zeroingVerdict(spread(1, 400), 25).ok).toBe(true);
  });

  it('allows exactly the ceiling, and refuses one more', () => {
    expect(zeroingVerdict(spread(25, 2), 25).ok).toBe(true);
    expect(zeroingVerdict(spread(26, 2), 25).ok).toBe(false);
  });
});

describe('the listings backstop', () => {
  it('refuses a handful of products holding an impossible number of listings', () => {
    // The matching fault: few products, thousands of listings hanging off them.
    const verdict = zeroingVerdict(spread(2, MAX_ZEROING_LISTINGS), 25);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain('matching between products and listings');
  });

  it('says to check the matching rather than to raise a number', () => {
    // Deliberate: this ceiling is not a thing to tune, it is a symptom to investigate.
    const reason = (zeroingVerdict(spread(1, MAX_ZEROING_LISTINGS + 1), 25) as { reason: string }).reason;
    expect(reason).not.toContain('Settings');
    expect(reason).toContain('worth checking');
  });

  it('lets exactly the backstop through', () => {
    expect(zeroingVerdict(spread(1, MAX_ZEROING_LISTINGS), 25).ok).toBe(true);
  });
});

describe('the configured ceiling', () => {
  it('treats zero as "never empty anything automatically"', () => {
    expect(zeroingVerdict(spread(1, 1), 0).ok).toBe(false);
    expect(zeroingVerdict([], 0).ok).toBe(true);
  });

  it('falls back to 25 for a number that is not one', () => {
    expect(zeroingVerdict(spread(26, 1), Number.NaN).ok).toBe(false);
    expect(zeroingVerdict(spread(25, 1), Number.NaN).ok).toBe(true);
  });

  it('ignores a negative ceiling rather than letting it invert the guard', () => {
    expect(zeroingVerdict(spread(1, 1), -5).ok).toBe(true);
  });
});

describe('a run with nothing to empty', () => {
  it('goes ahead', () => {
    expect(zeroingVerdict([], 25)).toEqual({ ok: true, products: 0, listings: 0 });
  });
});

describe('the words it refuses in', () => {
  it('counts one product and one listing in the singular', () => {
    const reason = (zeroingVerdict(spread(1, 1), 0) as { reason: string }).reason;
    expect(reason).toContain('1 product ');
    expect(reason).toContain('1 listing)');
  });

  it('says nothing was sent, because nothing was', () => {
    expect((zeroingVerdict(spread(30, 1), 25) as { reason: string }).reason).toContain('Nothing was sent');
  });
});
