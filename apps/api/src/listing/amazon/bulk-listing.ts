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
  /**
   * Nothing is wrong here except that nobody has said how long dispatch takes.
   *
   * Reported as its own flag rather than left for a screen to recognise by matching the sentence,
   * because it is the one blocker the reader can clear on the spot. Everything else needs a trip
   * somewhere else — Amazon, the brand, the product record. True ONLY when handling time is the
   * sole blocker: supplying one where the ASIN is also missing fixes nothing, and offering a box
   * that cannot help is worse than offering none.
   */
  blockedOnlyByHandlingTime: boolean;
}

const HANDLING_BLOCKER = 'No handling time set — enter days to dispatch above';

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
  if (f.handlingTimeDays == null) blockers.push(HANDLING_BLOCKER);

  /**
   * A brand restriction warns and does not block.
   *
   * The same rule as the single-listing flow, and deliberately so: the restriction is a commercial
   * matter recorded from a letter, and the person listing may know it was withdrawn. Making it a
   * blocker here and a warning there would mean the two paths disagree about what is allowed.
   */
  if (f.brandRestriction) warnings.push(f.brandRestriction);
  if (f.quantity === 0) warnings.push('Zero stock — the listing will go live out of stock');

  return {
    canList: blockers.length === 0,
    blockers,
    warnings,
    blockedOnlyByHandlingTime: blockers.length === 1 && blockers[0] === HANDLING_BLOCKER,
  };
}

/**
 * Days to dispatch, as someone typed it.
 *
 * Whole days only — Amazon's lead_time_to_ship_max_days is an integer, and half a day silently
 * truncated is a different promise from the one that was made. Zero is allowed and means same-day
 * dispatch; it is unusual enough to be worth accepting deliberately rather than treating as empty.
 *
 * The ceiling is not arithmetic. Amazon rejects long handling times on most marketplaces, and a
 * figure beyond a month is far more often a typo than a plan.
 */
export function parseHandlingDays(raw: unknown): { ok: true; days: number } | { ok: false; reason: string } {
  if (raw === '' || raw == null) return { ok: false, reason: 'Enter the days to dispatch' };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, reason: 'Days to dispatch must be a number' };
  if (!Number.isInteger(n)) return { ok: false, reason: 'Days to dispatch must be a whole number of days' };
  if (n < 0) return { ok: false, reason: 'Days to dispatch cannot be negative' };
  if (n > 30) return { ok: false, reason: 'Amazon will not accept a handling time longer than 30 days' };
  return { ok: true, days: n };
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

/**
 * Handling times a caller supplied for a bulk listing run.
 *
 * `applyToAll` is a convenience, not a separate rule: it fills in every channel that has no figure
 * of its own. Most products dispatch in the same time everywhere, and making somebody type the same
 * number eighteen times is how the eighteenth ends up different from the rest by accident.
 */
export interface BulkHandlingInput {
  applyToAll?: number | string | null;
  perChannel?: Record<string, number | string | null>;
}
