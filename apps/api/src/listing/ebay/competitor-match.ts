/**
 * Which of eBay's search results are actually the same product.
 *
 * This exists because of what the probe found. eBay's catalogue does not carry our barcodes — a
 * `gtin=` search matched nothing on any product tried — so competing offers can only be found by
 * words. And a word search for "Braun SI3055BK Steam Iron" returns the right iron twice, then an
 * SI5088, then a red SI1019RD. Priced against that set, a £30 iron would be quoted against an £90
 * one.
 *
 * So the search is treated as a list of CANDIDATES, and only offers whose title carries the
 * manufacturer part number count. That is the same identifier discipline used everywhere else here:
 * a part number is the product, a product name is a family.
 *
 * Condition matters as much. A used listing is a different market — "Used Once" at £28.99 sits
 * beside new stock at £34.99 — so pricing new stock against it would quietly undercut ourselves.
 *
 * PURE.
 */
import { looseSkuKey } from '../../channel-listings/sku-match';

export interface CompetitorOffer {
  title: string | null;
  priceCents: number | null;
  currency: string | null;
  condition: string | null;
  seller: string | null;
  url: string | null;
  freeShipping: boolean | null;
}

export interface MatchedCompetitors {
  matched: CompetitorOffer[];
  rejected: Array<{ offer: CompetitorOffer; why: string }>;
  /** Cheapest, dearest and middle of what survived — null when nothing did. */
  summary: { lowestCents: number; highestCents: number; medianCents: number; currency: string | null } | null;
}

/** eBay's condition values for unused stock. Anything else is a different market. */
const NEW_CONDITIONS = ['new', 'brand new', 'new other', 'new with tags', 'new without tags'];

export function matchCompetitors(
  offers: readonly CompetitorOffer[],
  opts: { mpn: string | null; requireNew?: boolean },
): MatchedCompetitors {
  const wanted = looseSkuKey(opts.mpn);
  const requireNew = opts.requireNew ?? true;

  const matched: CompetitorOffer[] = [];
  const rejected: MatchedCompetitors['rejected'] = [];

  for (const offer of offers) {
    const title = offer.title ?? '';

    /**
     * Without a part number there is nothing to match on, and matching on the product name would
     * return the family. Everything is rejected rather than everything accepted.
     */
    if (!wanted) {
      rejected.push({ offer, why: 'this product has no manufacturer part number to match a listing against' });
      continue;
    }
    // Same normalisation both sides, so "SI3055BK", "si3055bk" and "SI-3055-BK" are one code.
    if (!looseSkuKey(title).includes(wanted)) {
      rejected.push({ offer, why: `its title does not carry the part number ${opts.mpn}, so it is probably a different model` });
      continue;
    }
    if (requireNew && !NEW_CONDITIONS.includes((offer.condition ?? '').trim().toLowerCase())) {
      rejected.push({ offer, why: `it is ${offer.condition || 'of unstated condition'}, which is a different market from new stock` });
      continue;
    }
    if (offer.priceCents == null || offer.priceCents <= 0) {
      rejected.push({ offer, why: 'it has no usable price' });
      continue;
    }
    matched.push(offer);
  }

  const prices = matched.map((o) => o.priceCents as number).sort((a, b) => a - b);
  const summary = prices.length
    ? {
      lowestCents: prices[0],
      highestCents: prices[prices.length - 1],
      /** The middle one, not the mean: one mispriced listing should not drag the figure. */
      medianCents: prices.length % 2
        ? prices[(prices.length - 1) / 2]
        : Math.round((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2),
      currency: matched[0].currency,
    }
    : null;

  return { matched, rejected, summary };
}
