/**
 * Deciding whether one channel can be listed on as part of "list everywhere".
 *
 * Separated from the service that gathers the facts, because the facts come from six different
 * places and the judgement made from them is the part worth being sure about. This is the most
 * dangerous button in the platform — one press can create real offers on a dozen marketplaces — so
 * every reason a channel is excluded has to be nameable, and no channel may be included by default.
 *
 * Nothing here is a warning to be scrolled past. A blocker means the channel is left out.
 */

export interface BulkChannelFacts {
  /** Amazon has a catalogue entry we could attach an offer to. */
  found: boolean;
  /** Amazon's approval gating. null means the check failed — unknown, which is not permission. */
  restricted: boolean | null;
  /** We already sell here. Nothing to create. */
  alreadyListed: boolean;
  /** The product is not permitted on this marketplace (voltage, plug, compliance). */
  eligible: boolean;
  eligibilityReasons: string[];
  /** The ASIN to offer on. */
  asin: string | null;
  /** What the requested margin works out to here. Null when it could not be priced. */
  priceCents: number | null;
  priceReason: string | null;
  /** Sellable units. Zero is a real answer — listed but out of stock — so only null is missing. */
  quantity: number | null;
  /** Days to dispatch. Amazon requires it and there is no sane default to invent. */
  handlingTimeDays: number | null;
  /** A brand has asked us not to sell here. Warns; never blocks. */
  brandRestriction: string | null;
}

export interface BulkChannelVerdict {
  canList: boolean;
  /** Every reason it is excluded, not just the first — fixing one at a time is a slow way to work. */
  blockers: string[];
  /** Things worth knowing that do not prevent listing. */
  warnings: string[];
}

export function verdictFor(f: BulkChannelFacts): BulkChannelVerdict {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (f.alreadyListed) blockers.push('Already listed here');
  if (!f.found) blockers.push('Amazon has no catalogue entry for this product here');
  // Unknown gating is a blocker, not a shrug. The only way to find out whether we may sell a brand
  // is to ask, and a bulk action is the worst possible place to guess: the answer arrives as a
  // suppressed listing on a marketplace nobody was watching.
  if (f.restricted === true) blockers.push('Approval needed to list this brand here');
  if (f.restricted == null && f.found) blockers.push('Could not check whether this brand needs approval here');
  if (!f.eligible) blockers.push(f.eligibilityReasons[0] ?? 'Not permitted on this marketplace');
  if (!f.asin) blockers.push('No ASIN to offer on');
  if (f.priceCents == null || f.priceCents <= 0) blockers.push(f.priceReason ?? 'Could not work out a price at this margin');
  if (f.quantity == null) blockers.push('No sellable quantity recorded');
  if (f.handlingTimeDays == null) blockers.push('No handling time set — list one channel manually first, then this can copy it');

  /**
   * A brand restriction warns and does not block.
   *
   * The same rule as the single-listing flow, and deliberately so: the restriction is a commercial
   * matter recorded from a letter, and the person listing may know it was withdrawn. Making it a
   * blocker here and a warning there would mean the two paths disagree about what is allowed.
   */
  if (f.brandRestriction) warnings.push(f.brandRestriction);
  if (f.quantity === 0) warnings.push('Zero stock — the listing will go live out of stock');

  return { canList: blockers.length === 0, blockers, warnings };
}

/** A margin a person typed, or a refusal. Percent, not a fraction. */
export function parseMarginPct(raw: unknown): { ok: true; marginPct: number } | { ok: false; reason: string } {
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, reason: 'Enter a profit percentage' };
  // Zero would list everything at breakeven, which nobody means to do in bulk. The upper bound is
  // not arithmetic — a 95% margin is simply a typo for 9.5% far more often than it is a plan.
  if (n <= 0) return { ok: false, reason: 'The profit percentage must be above zero' };
  if (n > 90) return { ok: false, reason: 'A profit percentage above 90% is almost certainly a typo' };
  return { ok: true, marginPct: Math.round(n * 10) / 10 };
}
