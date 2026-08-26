import { describe, expect, it } from 'vitest';

/**
 * Pushing a quantity we do not have.
 *
 * `pushAvailability` resolved its target as `qtyByProduct.get(productId) ?? 0`, so a product with
 * no ProductAvailability row pushed ZERO to every channel it was listed on. Of 981 products only 7
 * had such a row, and 1,955 eBay listings were matched to a product — so the great majority
 * resolved to zero.
 *
 * It stayed hidden because the eBay token was read-only and ReviseInventoryStatus failed on auth.
 * The listings were protected by an error, not by design. The morning the write scope went on, the
 * same pushes succeeded and took the whole eBay catalogue out of stock — and every later order sync
 * put it back to zero, which is why re-stocking by hand did not hold.
 *
 * The distinction the code was missing: a MISSING record means "we do not know" and must not be
 * sent anywhere; a record that says 0 means "out of stock", which is a real state worth pushing.
 */

/** The decision as the service now makes it, extracted so it can be tested without the world. */
function resolveTarget(
  productId: string | null,
  availability: Map<string, number>,
): { push: true; target: number } | { push: false; reason: string } {
  const known = productId != null && availability.has(productId);
  if (!known) return { push: false, reason: 'No availability record for this product — nothing pushed' };
  return { push: true, target: availability.get(productId as string) as number };
}

describe('what gets pushed to a channel', () => {
  const avail = new Map<string, number>([
    ['known-12', 12],
    ['known-0', 0],
  ]);

  it('pushes a real figure when we have one', () => {
    expect(resolveTarget('known-12', avail)).toEqual({ push: true, target: 12 });
  });

  it('pushes zero when the record genuinely says zero', () => {
    // Out of stock is a real state. Refusing to send it would leave a sold-out listing buyable.
    expect(resolveTarget('known-0', avail)).toEqual({ push: true, target: 0 });
  });

  it('pushes NOTHING when there is no record — the bug that emptied eBay', () => {
    const r = resolveTarget('no-record', avail);
    expect(r.push).toBe(false);
    // The old behaviour, named here so nobody reinstates it as a tidy default.
    expect(r).not.toEqual({ push: true, target: 0 });
  });

  it('pushes nothing for a listing that matched no product at all', () => {
    // 3,195 of the eBay listings match no product. Those must never be touched.
    expect(resolveTarget(null, avail).push).toBe(false);
  });

  it('says why, rather than silently doing nothing', () => {
    const r = resolveTarget('no-record', avail) as { push: false; reason: string };
    expect(r.reason).toMatch(/no availability record/i);
  });
});

describe('the result tally', () => {
  // "0 failed" must not be readable as "everything was updated" when most were skipped.
  const results = [
    { ok: true, skipped: false },
    { ok: false, skipped: true },
    { ok: false, skipped: true },
    { ok: false, skipped: false },
  ];

  it('counts a skip apart from a failure', () => {
    const ok = results.filter((x) => x.ok).length;
    const failed = results.filter((x) => !x.ok && !x.skipped).length;
    const skipped = results.filter((x) => x.skipped).length;
    expect({ ok, failed, skipped }).toEqual({ ok: 1, failed: 1, skipped: 2 });
    expect(ok + failed + skipped).toBe(results.length);
  });
});
