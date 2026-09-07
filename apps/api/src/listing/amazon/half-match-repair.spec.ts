import { describe, expect, it } from 'vitest';

/**
 * A plan holding an ASIN but no Amazon product type.
 *
 * Found in production on Amazon UK for LAG-095243: every other marketplace carried
 * BOTTLE_STOPPER against the same ASIN, UK carried the ASIN and null. Listing there failed with
 * "The plan has no Amazon product type set" — a message about a field nobody was ever asked for,
 * on a marketplace that looked matched everywhere it was displayed.
 *
 * It came from the product card, which wrote the ASIN unconditionally and the product type only
 * when Amazon's search happened to return one:
 *
 *     aspects: { asin: picked.asin },
 *     ...(picked.productType ? { categoryRef: picked.productType } : {}),
 *
 * Two fixes, and this pins the rule behind both: the type is Amazon's own classification OF the
 * chosen ASIN, not a second choice, so completing it from a stored check decides nothing on
 * anyone's behalf — while INVENTING one would.
 */

/** The resolution order buildFromPlan follows. */
function resolveProductType(args: {
  planCategoryRef: string | null;
  planAsin: string | null;
  storedForThisAsin: string | null;
}): { ok: true; productType: string; repaired: boolean } | { ok: false; reason: 'unmatched' | 'no-type' } {
  if (args.planCategoryRef) return { ok: true, productType: args.planCategoryRef, repaired: false };
  if (args.storedForThisAsin && args.planAsin) {
    return { ok: true, productType: args.storedForThisAsin, repaired: true };
  }
  return { ok: false, reason: args.planAsin ? 'no-type' : 'unmatched' };
}

describe('completing a half-matched plan', () => {
  it('uses the plan’s own type when it has one', () => {
    const r = resolveProductType({ planCategoryRef: 'BOTTLE_STOPPER', planAsin: 'B0035LDBRK', storedForThisAsin: 'OTHER' });
    expect(r).toEqual({ ok: true, productType: 'BOTTLE_STOPPER', repaired: false });
  });

  it('completes a missing type from the stored check for that exact ASIN', () => {
    // The real UK case. Nothing is decided here — the ASIN was already chosen by a person, and the
    // type is Amazon's classification of it.
    const r = resolveProductType({ planCategoryRef: null, planAsin: 'B0035LDBRK', storedForThisAsin: 'BOTTLE_STOPPER' });
    expect(r).toEqual({ ok: true, productType: 'BOTTLE_STOPPER', repaired: true });
  });

  it('refuses rather than inventing a type when none is stored', () => {
    // Guessing a product type files the listing under the wrong category, which changes which
    // attributes are even valid. A refusal that says what to do beats a plausible wrong answer.
    const r = resolveProductType({ planCategoryRef: null, planAsin: 'B0035LDBRK', storedForThisAsin: null });
    expect(r).toEqual({ ok: false, reason: 'no-type' });
  });

  it('will not borrow a type when there is no ASIN to borrow it for', () => {
    // No ASIN means unmatched, and the message should say that rather than complaining about a
    // product type for a listing nobody has chosen.
    const r = resolveProductType({ planCategoryRef: null, planAsin: null, storedForThisAsin: 'BOTTLE_STOPPER' });
    expect(r).toEqual({ ok: false, reason: 'unmatched' });
  });

  it('distinguishes the two refusals, because they need different actions', () => {
    expect(resolveProductType({ planCategoryRef: null, planAsin: 'B1', storedForThisAsin: null }).ok).toBe(false);
    expect(resolveProductType({ planCategoryRef: null, planAsin: null, storedForThisAsin: null }))
      .toEqual({ ok: false, reason: 'unmatched' });
  });
});
