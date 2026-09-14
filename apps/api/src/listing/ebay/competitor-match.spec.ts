import { describe, expect, it } from 'vitest';
import { matchCompetitors, type CompetitorOffer } from './competitor-match';

const offer = (title: string, priceCents: number | null, condition = 'New'): CompetitorOffer =>
  ({ title, priceCents, currency: 'GBP', condition, seller: 's', url: 'https://ebay.co.uk/itm/1', freeShipping: null });

/** Exactly what eBay returned for "Braun SI3055BK Steam Iron" during the probe. */
const REAL = [
  offer('Braun TexStyle 3 Steam Iron SI3055BK - 2400W Black - Used Once', 2899, 'Used'),
  offer('Braun SI3055BK TexStyle 3 Steam Iron BN3055 Black Freeglide', 3499),
  offer('Braun Steam Iron - FreeStyle 5 Steam iron SI5088 Black - New', 8999),
  offer('Braun SI1019RD TexStyle 1 1900W Steam Iron - Red/White', 3054),
  offer('Braun TexStyle 3 Steam Iron 2400W Ceramic Soleplate Black', 3299),
];

describe('matchCompetitors', () => {
  /** The whole point: of five results eBay called relevant, one is this product on sale as new. */
  it('keeps only the offers carrying this part number, in new condition', () => {
    const out = matchCompetitors(REAL, { mpn: 'SI3055BK' });
    expect(out.matched).toHaveLength(1);
    expect(out.matched[0].priceCents).toBe(3499);
    expect(out.rejected).toHaveLength(4);
  });

  it('says why each one was left out', () => {
    const out = matchCompetitors(REAL, { mpn: 'SI3055BK' });
    const why = out.rejected.map((r) => r.why);
    expect(why.filter((w) => w.includes('different market'))).toHaveLength(1); // the used one
    expect(why.filter((w) => w.includes('different model'))).toHaveLength(3); // SI5088, SI1019RD, unnumbered
  });

  it('ignores punctuation and casing in the part number', () => {
    const out = matchCompetitors([offer('Braun si-3055-bk iron', 3000)], { mpn: 'SI3055BK' });
    expect(out.matched).toHaveLength(1);
  });

  it('can be asked to include used stock', () => {
    const out = matchCompetitors(REAL, { mpn: 'SI3055BK', requireNew: false });
    expect(out.matched).toHaveLength(2);
  });

  /**
   * Without a part number there is nothing to match on. Rejecting everything is right: matching on
   * the product name would price us against the family, which is how the £90 model gets in.
   */
  it('rejects everything when the product has no part number', () => {
    const out = matchCompetitors(REAL, { mpn: null });
    expect(out.matched).toEqual([]);
    expect(out.rejected[0].why).toContain('no manufacturer part number');
  });

  it('drops an offer with no usable price', () => {
    const out = matchCompetitors([offer('Braun SI3055BK iron', null)], { mpn: 'SI3055BK' });
    expect(out.matched).toEqual([]);
    expect(out.rejected[0].why).toContain('no usable price');
  });

  describe('summary', () => {
    it('reports the range and the middle price of what survived', () => {
      const out = matchCompetitors(
        [offer('X SI3055BK a', 3000), offer('X SI3055BK b', 3400), offer('X SI3055BK c', 5000)],
        { mpn: 'SI3055BK' },
      );
      expect(out.summary).toEqual({ lowestCents: 3000, highestCents: 5000, medianCents: 3400, currency: 'GBP' });
    });

    it('averages the middle two when there is an even number', () => {
      const out = matchCompetitors(
        [offer('X SI3055BK a', 3000), offer('X SI3055BK b', 3400)],
        { mpn: 'SI3055BK' },
      );
      expect(out.summary?.medianCents).toBe(3200);
    });

    it('is null when nothing matched, rather than a range of nothing', () => {
      expect(matchCompetitors(REAL, { mpn: 'NOTHING-LIKE-IT' }).summary).toBeNull();
      expect(matchCompetitors([], { mpn: 'SI3055BK' }).summary).toBeNull();
    });
  });
});
