import { describe, expect, it } from 'vitest';

/**
 * What a per-product listings check may change.
 *
 * The account-wide sync and this one answer the same question from opposite ends, and the
 * difference decides what each is allowed to delete.
 *
 * The account-wide pull ENUMERATES: it walks the seller's listings and takes what it gets. Amazon
 * stops paginating at 1,000, so absence there is not evidence — on 5 Sep 2026 that deleted 484
 * live listings across five marketplaces, and IT68277 on Amazon ES read as "not listed" while it
 * sat there Inactive with a product-safety violation.
 *
 * This one ASKS BY NAME: "is SKU IT68277 listed here?" Nothing is being enumerated, so nothing can
 * fall off the end of a page, and a SKU missing from the reply really is not listed. That is what
 * makes removing a stale record safe here and unsafe there.
 *
 * The rule below is the whole of it, and the third case is the one that matters: a marketplace we
 * could not reach must be left alone. "We failed to ask" and "it is not there" arrive as the same
 * empty list, and treating them alike is how the first incident happened.
 */

type Answer =
  | { ok: true; skusFound: string[] }
  /** The marketplace could not be asked — a token failure, a 500, a timeout. */
  | { ok: false };

interface Outcome {
  /** SKUs to write or refresh. */
  upsert: string[];
  /** SKUs whose records for THIS product should go. */
  remove: string[];
  /** True when the marketplace was left exactly as found. */
  untouched: boolean;
}

/** The reconcile decision for one product on one marketplace. */
function reconcile(answer: Answer, held: string[]): Outcome {
  if (!answer.ok) return { upsert: [], remove: [], untouched: true };
  const found = answer.skusFound;
  return {
    upsert: found,
    remove: held.filter((h) => !found.includes(h)),
    untouched: false,
  };
}

describe('per-product listings reconcile', () => {
  it('records a listing the marketplace confirms', () => {
    const out = reconcile({ ok: true, skusFound: ['IT68277'] }, []);
    expect(out.upsert).toEqual(['IT68277']);
    expect(out.remove).toEqual([]);
  });

  it('keeps a record that is still there, without churn', () => {
    const out = reconcile({ ok: true, skusFound: ['IT68277'] }, ['IT68277']);
    expect(out.upsert).toEqual(['IT68277']);
    expect(out.remove).toEqual([]);
  });

  it('removes a record for a SKU the marketplace says it does not carry', () => {
    // Safe ONLY because the SKU was asked about by name. The account-wide sync may not conclude
    // this from an empty result, because its emptiness can be a paging limit instead.
    const out = reconcile({ ok: true, skusFound: [] }, ['IT68277']);
    expect(out.remove).toEqual(['IT68277']);
    expect(out.untouched).toBe(false);
  });

  it('changes NOTHING when the marketplace could not be asked', () => {
    // The failure the whole design turns on: an error and a genuine "not listed" both look like
    // an empty list, and only one of them is an answer.
    const out = reconcile({ ok: false }, ['IT68277']);
    expect(out).toEqual({ upsert: [], remove: [], untouched: true });
  });

  it('never removes a record it did not ask about', () => {
    // A product listed under two SKUs, one delisted. The surviving one must not be caught by the
    // removal of the other.
    const out = reconcile({ ok: true, skusFound: ['IT68277'] }, ['IT68277', 'IT68277-OLD']);
    expect(out.remove).toEqual(['IT68277-OLD']);
    expect(out.upsert).toContain('IT68277');
  });

  it('handles a product listed nowhere, holding nothing, as a no-op', () => {
    expect(reconcile({ ok: true, skusFound: [] }, [])).toEqual({ upsert: [], remove: [], untouched: false });
  });

  it('leaves records alone across every held state when the call fails', () => {
    // Stated over the space rather than case by case: no failed answer may ever remove anything.
    for (const held of [[], ['A'], ['A', 'B'], ['IT68277', 'X', 'Y']]) {
      expect(reconcile({ ok: false }, held).remove).toEqual([]);
    }
  });
});
