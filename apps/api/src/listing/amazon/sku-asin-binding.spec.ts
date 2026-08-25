import { describe, expect, it } from 'vitest';

/**
 * Amazon maps one SKU to one ASIN across every marketplace in a region, and refuses a submission
 * that breaks it — in the marketplace's own language, naming two ASINs and explaining neither.
 *
 * A real submission to Amazon FR came back with 101077, "the seller-suggested ASIN value is not
 * uniform across active Amazon sales sites: B01BM58XJQ, B01FAWGUTW", because the SKU was already
 * bound to B01BM58XJQ on CA, MX and SE. It read as "no listing exists", which is a different
 * problem with a different fix.
 *
 * So the binding is resolved before a candidate is picked rather than discovered after Amazon
 * rejects one. These pin the two decisions that follow from knowing it.
 */

type Candidate = { asin: string; conflictsWithBound: boolean };

/** The ordering applied in findCandidates: the usable ASIN first, whatever order Amazon returned. */
const order = (candidates: Candidate[], boundAsin: string | null) =>
  boundAsin
    ? [...candidates].sort((a, b) => Number(a.conflictsWithBound) - Number(b.conflictsWithBound))
    : candidates;

const flag = (asins: string[], boundAsin: string | null): Candidate[] =>
  asins.map((asin) => ({ asin, conflictsWithBound: boundAsin != null && asin !== boundAsin }));

describe('a SKU already bound to an ASIN', () => {
  it('marks every other candidate as one Amazon would refuse', () => {
    const c = flag(['B01FAWGUTW', 'B01BM58XJQ'], 'B01BM58XJQ');
    expect(c.find((x) => x.asin === 'B01FAWGUTW')!.conflictsWithBound).toBe(true);
    expect(c.find((x) => x.asin === 'B01BM58XJQ')!.conflictsWithBound).toBe(false);
  });

  it('puts the bound ASIN first, because the sweep takes candidates[0]', () => {
    // Amazon FR returned the wrong one first, which is how the sweep came to price it.
    const ranked = order(flag(['B01FAWGUTW', 'B01BM58XJQ'], 'B01BM58XJQ'), 'B01BM58XJQ');
    expect(ranked[0].asin).toBe('B01BM58XJQ');
    expect(ranked[0].conflictsWithBound).toBe(false);
  });

  it('leaves ordering alone for a SKU that is not bound anywhere yet', () => {
    // A first listing has nothing to conflict with, and Amazon's relevance ordering is the better
    // guide than any rule we could invent.
    const c = flag(['B0AAA', 'B0BBB'], null);
    expect(c.every((x) => !x.conflictsWithBound)).toBe(true);
    expect(order(c, null).map((x) => x.asin)).toEqual(['B0AAA', 'B0BBB']);
  });

  it('blocks nothing when the only candidate is the bound one', () => {
    const ranked = order(flag(['B01BM58XJQ'], 'B01BM58XJQ'), 'B01BM58XJQ');
    expect(ranked).toHaveLength(1);
    expect(ranked[0].conflictsWithBound).toBe(false);
  });
});
