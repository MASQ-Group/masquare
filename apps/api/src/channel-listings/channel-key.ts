/**
 * The id one sellable channel is known by.
 *
 * Not the same thing as an integration. eBay holds ONE integration and one token across every
 * marketplace it sells on, so `ebay-uk` and `ebay-de` are two channels behind a single connection;
 * Amazon and OnBuy connect once per marketplace and store an empty string instead.
 *
 * The listing's marketplace decides it, never the integration's. An Amazon integration carries a
 * label like `Amazon.co.uk` in its own `marketplace` column while its listings all store `''` — key
 * on the integration's copy and every Amazon listing lands under an id no channel answers to.
 *
 * It lives alone in this file because two places need the same answer: the Channel Listings grid,
 * which builds a column per channel, and the Products list, which says whether a product reached
 * any of them. A second implementation of this would not fail loudly — it would quietly report a
 * product as unlisted on a channel it is listed on, which is the kind of wrong that gets believed.
 */
export function channelKey(listing: { integrationId: string; marketplace?: string | null }): string {
  const marketplace = (listing.marketplace ?? '').trim();
  return marketplace ? `${listing.integrationId}:${marketplace}` : listing.integrationId;
}
