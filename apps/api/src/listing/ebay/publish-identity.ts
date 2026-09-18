import { ebaySafeSku } from './offer-payload';

/**
 * Which eBay listing a publish is about: a new one, the one we already made, or none at all.
 *
 * eBay finds a listing by SKU, and a publish never asked whether the product was already on eBay.
 * That was quietly safe for as long as nothing changed a SKU and nothing listed a product twice —
 * and neither is true any more.
 *
 * - Most of this account's eBay listings were made by hand or through the older Trading API. The
 *   Inventory API that publishing uses cannot see them, so publishing any of those products made a
 *   second listing of it: 600 products were one click from that when this was written. eBay does not
 *   allow duplicate listings.
 * - A few went out under a SKU stripped of its punctuation (LE83306 for LE-83306; LAGA158WEA9EF for
 *   LAG-A158WEA-9EF). Now that the product's own SKU is sent, publishing one of those again would
 *   miss the offer eBay holds under the stripped SKU and create a second listing beside it.
 *
 * So this decides before anything is sent. A listing this platform published and recorded is
 * updated in place, under the SKU it was made with. A stripped listing — a shape only this
 * platform's own code ever produced — is adopted and updated the same way. Anything else already on
 * eBay is refused, naming the item, rather than duplicated.
 *
 * PURE.
 */

export interface PlanIdentity {
  status: string | null;
  /** The SKU this plan's listing was created under, once one was. */
  channelSku: string | null;
  externalListingId: string | null;
}

/** A listing eBay holds for this product on this account, as the last sync saw it. */
export interface ExistingListing {
  channelSku: string;
  itemId: string | null;
}

export type PublishIdentity =
  /** Nothing on eBay yet: create it under the product's own SKU. */
  | { action: 'create'; sku: string }
  /** Ours already: bring that same listing up to date. `adopted` when it was found rather than recorded. */
  | { action: 'update'; sku: string; itemId: string | null; adopted: boolean }
  /** Something else is already on eBay for this product. Sending would make a second listing. */
  | { action: 'refuse'; reason: string; items: ExistingListing[] };

/** The form our own code used to send a SKU in, before punctuation was left alone. */
const stripped = (sku: string) => sku.replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);

export function publishIdentity(args: {
  mainSku: string;
  plan: PlanIdentity | null;
  existing: readonly ExistingListing[];
}): PublishIdentity {
  const { mainSku, plan, existing } = args;

  // 1. We made it and wrote it down. Update exactly that one, under exactly that SKU.
  if (plan?.status === 'LISTED' && plan.channelSku) {
    return { action: 'update', sku: plan.channelSku, itemId: plan.externalListingId, adopted: false };
  }

  // 2. Nothing on eBay: a first listing, under the product's own SKU.
  if (existing.length === 0) return { action: 'create', sku: ebaySafeSku(mainSku) };

  // 3. One of ours published stripped, before publishes were recorded. Only our own code ever
  //    produced a SKU that is the product's with its punctuation removed — hand-made listings keep
  //    their hyphens — so a single match of that exact shape is ours to update.
  const ours = stripped(mainSku);
  const strippedMatches = existing.filter((l) => l.channelSku === ours);
  if (ours !== mainSku && strippedMatches.length === 1 && existing.length === 1) {
    return { action: 'update', sku: ours, itemId: strippedMatches[0].itemId, adopted: true };
  }

  // 4. Anything else already on eBay is not ours to overwrite and must not be duplicated.
  const named = existing
    .slice(0, 3)
    .map((l) => (l.itemId ? `item ${l.itemId} (SKU ${l.channelSku})` : `SKU ${l.channelSku}`))
    .join(', ');
  const more = existing.length > 3 ? ` and ${existing.length - 3} more` : '';
  return {
    action: 'refuse',
    items: [...existing],
    reason:
      `This product is already on eBay — ${named}${more}. Publishing would create a second listing of it, `
      + 'which eBay does not allow. Update that listing on eBay itself, or end it there first.',
  };
}
