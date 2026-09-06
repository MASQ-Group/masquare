/**
 * Channels a brand has told us not to sell them on.
 *
 * Nothing to do with Amazon's gating. Amazon may be perfectly willing to take the listing, and the
 * restriction still stands, because it came from the brand in writing. Reported separately for that
 * reason: "Amazon will not let you" and "Beurer asked you not to" are different facts with different
 * remedies, and collapsing them into one warning loses which one you are looking at.
 *
 * Never a block. A brand restriction is a commercial and contractual matter, and the person listing
 * the product may know something the record does not — that the letter was withdrawn, that it
 * covered a product line we no longer carry, that legal have cleared it. The platform's job is to
 * make sure nobody lists in ignorance of it, not to decide on their behalf.
 */

export interface BrandRestriction {
  channelType: string;
  /** ISO-2 marketplace, or '' for every marketplace of that channel type. */
  marketplace: string;
  note?: string | null;
}

export interface ChannelRef {
  channelType: string;
  marketplace?: string | null;
}

/**
 * The restriction covering this channel, if any.
 *
 * A blank marketplace on the restriction covers the whole channel type — "not on eBay at all" —
 * so it matches every marketplace of that type. A named marketplace matches only itself.
 *
 * The more specific rule wins when both exist, because that is what someone recording an exception
 * would expect: a note attached to Amazon US should be the one you see on Amazon US.
 */
export function restrictionFor(channel: ChannelRef, restrictions: BrandRestriction[]): BrandRestriction | null {
  const type = (channel.channelType ?? '').toLowerCase();
  const market = (channel.marketplace ?? '').toUpperCase();

  const forType = restrictions.filter((r) => (r.channelType ?? '').toLowerCase() === type);
  const exact = forType.find((r) => (r.marketplace ?? '').toUpperCase() === market && market !== '');
  if (exact) return exact;

  return forType.find((r) => (r.marketplace ?? '') === '') ?? null;
}

/** The sentence shown to whoever is about to list. Names the brand, the channel, and the reason. */
export function restrictionReason(brandName: string | null, channel: ChannelRef, r: BrandRestriction): string {
  const where = r.marketplace ? channelLabel(channel) : `${titleCase(r.channelType)} (all marketplaces)`;
  const who = brandName ? `${brandName} has` : 'The brand has';
  // The note carries the letter reference, which is the thing a person needs to look it up.
  return `${who} restricted sales on ${where}${r.note ? ` — ${r.note}` : ''}`;
}

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function channelLabel(channel: ChannelRef): string {
  const type = titleCase(channel.channelType ?? '');
  return channel.marketplace ? `${type} ${channel.marketplace}` : type;
}
