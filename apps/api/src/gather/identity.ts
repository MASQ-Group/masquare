/**
 * Is the thing the source found actually the thing we asked about?
 *
 * This module exists because of a real failure. A gather on Panasonic RP-HJE201E-K earphones came
 * back with Brand = Marley. The lookup was by barcode, exactly one product came back, and every
 * attribute on it was faithfully recorded — for somebody else's earphones. Nothing downstream could
 * catch it: the provenance rules judge whether sources AGREE ABOUT A FIELD, and there was only one
 * source, agreeing with itself about a product nobody had checked was the right one.
 *
 * So identity is verified before any attribute is believed, and the standard is deliberately harsh:
 *
 *   - A contradiction rejects outright. Their brand is Marley, ours is Panasonic: not our product.
 *   - No contradiction is not enough. If nothing positively corroborates the match — no brand, no
 *     part number, nothing to check against — the source is refused as unverifiable rather than
 *     trusted because it failed to disagree.
 *
 * Rejecting a whole source over one field looks severe until you remember what a mismatch means. It
 * is not one wrong value among good ones; it is a different product, so EVERY value is wrong, and
 * the ones that happen to look plausible are the dangerous ones.
 *
 * PURE.
 */
import { looseSkuKey } from '../channel-listings/sku-match';
import { comparable } from './value-match';

/** What we hold, and believe. */
export interface HeldIdentity {
  brand: string | null;
  mpn: string | null;
}

/** What the source says it found. Any field may be absent; absence is not disagreement. */
export interface SourceIdentity {
  brand: string | null;
  /** Part number, model number — whichever the source offers. Any one matching is enough. */
  mpns: string[];
  title: string | null;
}

export type IdentityVerdict =
  | { ok: true; matchedOn: Array<'brand' | 'mpn'> }
  | { ok: false; reason: string };

/**
 * Brand names are written loosely and still mean the same company: "Marley" and "House of Marley",
 * "Beurer" and "Beurer GmbH". Whole-word containment allows that, and only that — "Sony" does not
 * match "Sonya", because the check is on word boundaries rather than substrings.
 *
 * Deliberately more forgiving than the part-number check below. A brand is a company; a part number
 * is a specific object, and the difference between two part numbers is usually the difference
 * between two variants of the same product.
 */
function brandsAgree(a: string, b: string): boolean {
  const x = comparable(a);
  const y = comparable(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return ` ${long} `.includes(` ${short} `);
}

export function verifyIdentity(ours: HeldIdentity, theirs: SourceIdentity): IdentityVerdict {
  const matchedOn: Array<'brand' | 'mpn'> = [];

  const ourBrand = ours.brand?.trim() ?? '';
  const theirBrand = theirs.brand?.trim() ?? '';
  if (ourBrand && theirBrand) {
    if (!brandsAgree(ourBrand, theirBrand)) {
      return {
        ok: false,
        reason: `it returned a product branded "${theirBrand}" and this product is "${ourBrand}" — a different product, so nothing it said was used`,
      };
    }
    matchedOn.push('brand');
  }

  const ourMpn = looseSkuKey(ours.mpn);
  const theirMpns = theirs.mpns.map((m) => looseSkuKey(m)).filter(Boolean);
  if (ourMpn && theirMpns.length > 0) {
    /**
     * Strict, unlike the brand. Part numbers differing by one character is what distinguishes a
     * 900 W model from a 1200 W one, and those are exactly the products a barcode lookup confuses.
     */
    if (!theirMpns.includes(ourMpn)) {
      return {
        ok: false,
        reason: `its part number (${theirs.mpns.filter(Boolean).join(', ')}) is not this product's (${ours.mpn}) — a different product, so nothing it said was used`,
      };
    }
    matchedOn.push('mpn');
  }

  /**
   * Nothing contradicted, but nothing confirmed either. Treating that as a pass is how the Panasonic
   * case would still get through: a source that offers no brand and no part number offers no way to
   * tell whose attributes it is handing over.
   */
  if (matchedOn.length === 0) {
    return {
      ok: false,
      reason: 'nothing it returned could confirm this is the same product — no brand and no part number to check against, so its attributes were not used',
    };
  }

  return { ok: true, matchedOn };
}
