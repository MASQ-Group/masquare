// The attributes an offer-only submission carries, and the check that we have them.
//
// PURE: no network, no database. The submission is the one irreversible step in the whole flow, so
// the thing that decides what gets sent is kept where it can be read and tested in isolation.
//
// Every value is wrapped in an array of objects stamped with `marketplace_id` — that is the Listings
// Items shape, not a flourish. A value sent unstamped is accepted and then applied to nothing.

export interface OfferInput {
  /** The catalogue entry we are attaching to. Without it Amazon has nothing to join the offer to. */
  asin: string;
  marketplaceId: string;
  currency: string;
  /** Minor units, as everything else in the platform carries money. */
  priceCents: number | null;
  quantity: number | null;
  /** Days from order to dispatch. Amazon calls it lead time to ship. */
  handlingTimeDays: number | null;
  conditionType?: string;
  /** ISO-2. Amazon requires it on most product types. */
  countryOfOrigin?: string | null;
  packageWeightKg?: number | null;
  packageLengthCm?: number | null;
  packageWidthCm?: number | null;
  packageHeightCm?: number | null;
  warrantyText?: string | null;
  /** From the compliance vocabulary — 'NONE' means not dangerous goods. */
  hazmatCode?: string | null;
  batteryRequired?: boolean | null;
  /** The seller's shipping template name, where one is configured. */
  merchantShippingGroup?: string | null;
}

export interface MissingInput {
  key: string;
  label: string;
}

export interface OfferPayload {
  attributes: Record<string, unknown>;
  /** Anything the submission cannot go without. Non-empty means do not send. */
  missing: MissingInput[];
}

/** Amazon's condition codes. We sell new; the others exist so the value is never invented. */
export const CONDITION_CODES: Record<string, string> = {
  NEW: 'new_new',
  OPEN_BOX: 'used_like_new',
  USED: 'used_good',
};

const stamp = (marketplaceId: string, value: Record<string, unknown>) => ({ marketplace_id: marketplaceId, ...value });

/**
 * Build the attributes for an offer on an existing ASIN.
 *
 * Returns what is missing rather than throwing: the caller shows the gaps next to the fields that
 * would fill them, and a half-built payload is never handed to the submitter by accident.
 */
export function buildOfferAttributes(input: OfferInput): OfferPayload {
  const m = input.marketplaceId;
  const missing: MissingInput[] = [];

  if (!input.asin?.trim()) missing.push({ key: 'asin', label: 'Amazon listing (ASIN)' });
  // Zero is a real quantity — "out of stock but listed" — so only null is missing. Price is
  // different: a zero price is never intended, and Amazon would take it.
  if (input.priceCents == null || input.priceCents <= 0) missing.push({ key: 'price', label: 'Selling price' });
  if (input.quantity == null) missing.push({ key: 'quantity', label: 'Quantity' });
  if (input.handlingTimeDays == null) missing.push({ key: 'handlingTime', label: 'Handling time' });

  const attributes: Record<string, unknown> = {};

  if (input.asin?.trim()) {
    attributes.merchant_suggested_asin = [stamp(m, { value: input.asin.trim() })];
  }

  attributes.condition_type = [stamp(m, { value: input.conditionType ?? CONDITION_CODES.NEW })];

  if (input.priceCents != null && input.priceCents > 0) {
    // our_price is a schedule because Amazon models scheduled price changes; a single entry with no
    // end date is a plain price.
    attributes.purchasable_offer = [
      stamp(m, {
        currency: input.currency,
        our_price: [{ schedule: [{ value_with_tax: round2(input.priceCents / 100) }] }],
      }),
    ];
  }

  if (input.quantity != null) {
    const availability: Record<string, unknown> = {
      fulfillment_channel_code: 'DEFAULT',
      quantity: Math.max(0, Math.trunc(input.quantity)),
    };
    if (input.handlingTimeDays != null) {
      availability.lead_time_to_ship_max_days = Math.max(0, Math.trunc(input.handlingTimeDays));
    }
    // Not stamped: fulfilment availability is per listing, not per marketplace.
    attributes.fulfillment_availability = [availability];
  }

  if (input.countryOfOrigin?.trim()) {
    attributes.country_of_origin = [stamp(m, { value: input.countryOfOrigin.trim().toUpperCase() })];
  }

  // Metric throughout, because that is what the platform stores. Sending a number without its unit
  // is how a 1.2 kg parcel becomes 1.2 pounds somewhere downstream.
  if (input.packageWeightKg != null) {
    attributes.item_package_weight = [stamp(m, { value: round2(input.packageWeightKg), unit: 'kilograms' })];
  }
  if (input.packageLengthCm != null && input.packageWidthCm != null && input.packageHeightCm != null) {
    attributes.item_package_dimensions = [
      stamp(m, {
        length: { value: round2(input.packageLengthCm), unit: 'centimeters' },
        width: { value: round2(input.packageWidthCm), unit: 'centimeters' },
        height: { value: round2(input.packageHeightCm), unit: 'centimeters' },
      }),
    ];
  }

  if (input.warrantyText?.trim()) {
    attributes.warranty_description = [stamp(m, { value: input.warrantyText.trim() })];
  }

  // 'NONE' is a positive statement that the product is not regulated, and Amazon wants to be told
  // so explicitly — omitting the attribute is not the same answer.
  if (input.hazmatCode) {
    attributes.supplier_declared_dg_hz_regulation = [
      stamp(m, { value: input.hazmatCode === 'NONE' ? 'not_applicable' : input.hazmatCode.toLowerCase() }),
    ];
  }
  if (input.batteryRequired != null) {
    attributes.batteries_required = [stamp(m, { value: input.batteryRequired })];
  }

  if (input.merchantShippingGroup?.trim()) {
    attributes.merchant_shipping_group = [stamp(m, { value: input.merchantShippingGroup.trim() })];
  }

  return { attributes, missing };
}

/** Money and measurements go out at two decimals; Amazon rejects long floating tails. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
