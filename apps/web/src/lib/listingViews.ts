import type { QueryClient } from '@tanstack/react-query';

/**
 * Everything on the platform that answers "where is this listed?".
 *
 * The same records feed the Channel Listings dashboard, a product's listing page, the Channels tab
 * of a product card, and the Listed column in All Products. There are two ways to refresh those
 * records — the account-wide sync and the per-product one — and each used to refresh only the screen
 * it was pressed on, so the same product read as listed on four channels in one place and one in
 * another until somebody reloaded.
 *
 * Both syncs write the same table, so both end by invalidating this one list.
 */
const LISTING_VIEW_KEYS = [
  'channel-listings',
  'channel-listings-channels',
  'channel-listing-detail',
  // The product card's Channels tab and its plans.
  'listing',
  // All Products: the Listed column comes from the same rows.
  'products',
  'product',
];

export function invalidateListingViews(qc: QueryClient) {
  qc.invalidateQueries({
    predicate: (q) => {
      const head = q.queryKey[0];
      return typeof head === 'string' && LISTING_VIEW_KEYS.includes(head);
    },
  });
}
