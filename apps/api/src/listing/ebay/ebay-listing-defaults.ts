/**
 * The eBay account's standing answers: where goods ship from, and which postage, payment and
 * returns policies a listing carries.
 *
 * They belong to the CHANNEL, not to a product. An account has one location and, in practice, one
 * postage, payment and returns policy it uses for nearly everything — asking those four questions
 * on every product would be asking for the same four answers a thousand times, and getting one of
 * them wrong eventually. Answered once on the channel, overridden on the odd product that differs.
 *
 * Kept in the integration's non-secret `config`, because they are eBay's own identifiers for
 * records eBay holds: there is nothing to store about them here beyond which one was chosen, and a
 * policy deleted at eBay must be able to disappear from the list without a migration.
 *
 * PURE.
 */

export interface EbayListingDefaults {
  merchantLocationKey: string | null;
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
}

export const EMPTY_DEFAULTS: EbayListingDefaults = {
  merchantLocationKey: null,
  fulfillmentPolicyId: null,
  paymentPolicyId: null,
  returnPolicyId: null,
};

/** The key inside `ChannelIntegration.config`. One place, so a typo cannot silently read nothing. */
export const DEFAULTS_KEY = 'ebayListingDefaults';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Read them out of whatever the column holds. Anything unreadable reads as "not chosen" rather than
 * throwing: a malformed config must leave the listing gate saying what is missing, not break the
 * whole preview.
 */
export function ebayListingDefaults(config: unknown): EbayListingDefaults {
  const bag = (config as Record<string, unknown> | null)?.[DEFAULTS_KEY];
  if (!bag || typeof bag !== 'object') return { ...EMPTY_DEFAULTS };
  const d = bag as Record<string, unknown>;
  return {
    merchantLocationKey: str(d.merchantLocationKey),
    fulfillmentPolicyId: str(d.fulfillmentPolicyId),
    paymentPolicyId: str(d.paymentPolicyId),
    returnPolicyId: str(d.returnPolicyId),
  };
}

/**
 * The config to store after a change. Merges into the existing config rather than replacing it —
 * everything else in there (marketplace ids, seller id, sync settings) belongs to other features.
 */
export function withEbayListingDefaults(config: unknown, next: Partial<EbayListingDefaults>): Record<string, unknown> {
  const base = config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : {};
  const current = ebayListingDefaults(config);
  base[DEFAULTS_KEY] = {
    merchantLocationKey: next.merchantLocationKey !== undefined ? str(next.merchantLocationKey) : current.merchantLocationKey,
    fulfillmentPolicyId: next.fulfillmentPolicyId !== undefined ? str(next.fulfillmentPolicyId) : current.fulfillmentPolicyId,
    paymentPolicyId: next.paymentPolicyId !== undefined ? str(next.paymentPolicyId) : current.paymentPolicyId,
    returnPolicyId: next.returnPolicyId !== undefined ? str(next.returnPolicyId) : current.returnPolicyId,
  };
  return base;
}
