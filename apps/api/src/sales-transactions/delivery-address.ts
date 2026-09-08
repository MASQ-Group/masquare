/**
 * The delivery address on an order: where it may come from, and who is allowed to overwrite whom.
 *
 * Two routes in, and they must not fight. eBay and OnBuy hand us the address in the order payload
 * we already fetch. Amazon does not — buyer addresses are restricted data we hold no approval for —
 * so those are copied out of Seller Central by one of our people. If Amazon ever approves us, that
 * marketplace simply starts arriving by the first route; nothing here changes.
 */

/**
 * How long a delivery address is kept after the order it belongs to was despatched.
 *
 * Twelve months, and the number came from our own returns rather than from a round figure. Measured
 * across 151 returns and replacements, the gap between despatch and the day we acted on them ran to
 * a median of 113 days and a 99th percentile of 313. Purging at despatch — the intuitive answer —
 * would have left us with no address for 83% of them at the moment one was needed, and the practical
 * result would be somebody re-typing it out of Seller Central, which is worse for privacy as well as
 * for us. A year also sits beyond FedEx's nine-month claim window for a lost shipment.
 *
 * A constant rather than a setting. A retention period that can be changed on a screen gets changed
 * on a screen, and the reasoning above would not travel with it.
 */
export const ADDRESS_RETENTION_DAYS = 365;

/** The personal fields a purge empties. Everything else on the row is provenance, not identity. */
export const PURGEABLE_FIELDS = [
  'fullName', 'companyName', 'addressLine1', 'addressLine2', 'city',
  'stateOrRegion', 'postalCode', 'countryIso', 'phone', 'email', 'eori', 'vatNumber',
] as const;

/**
 * Whether an address has outlived the purpose it was collected for.
 *
 * The clock starts at despatch, because that is when the shipping purpose is discharged and the
 * only remaining ones — returns, replacements, carrier claims — start counting. An order that was
 * never despatched falls back to its own date: there is no shipping purpose left for it either.
 */
export function isPurgeDue(basisDate: Date | null, now: Date, retentionDays = ADDRESS_RETENTION_DAYS): boolean {
  if (!basisDate) return false;
  const ageDays = (now.getTime() - basisDate.getTime()) / 86_400_000;
  return ageDays >= retentionDays;
}

/**
 * The date the retention clock runs from.
 *
 * The LATEST outbound despatch, not the earliest: a part-shipped order is still being shipped, and
 * starting the clock at the first parcel would erase the address while the second is outstanding.
 */
export function retentionBasis(order: { date: Date; outboundShipmentDates: Date[] }): Date {
  const despatches = order.outboundShipmentDates.filter((d) => d instanceof Date && !isNaN(d.getTime()));
  if (despatches.length === 0) return order.date;
  return despatches.reduce((latest, d) => (d > latest ? d : latest));
}

/** The address as a channel supplies it, or as somebody types it. All optional — channels vary. */
export interface AddressInput {
  fullName?: string | null;
  companyName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateOrRegion?: string | null;
  postalCode?: string | null;
  countryIso?: string | null;
  phone?: string | null;
  email?: string | null;
  eori?: string | null;
  vatNumber?: string | null;
  isBusiness?: boolean | null;
}

export interface StoredAddress extends AddressInput {
  source: 'channel' | 'manual';
  editedAt: Date | null;
  /** Set once the retention purge has emptied this row. Permanent. */
  purgedAt?: Date | null;
}

export const ADDRESS_FIELDS = [
  'fullName', 'companyName', 'addressLine1', 'addressLine2', 'city',
  'stateOrRegion', 'postalCode', 'countryIso', 'phone', 'email',
  'eori', 'vatNumber',
] as const;

/** Blank strings are not values. A form submits '' for every field nobody filled in. */
const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** Trimmed, with the country code upper-cased — carriers reject 'gb'. */
export function normaliseAddress(input: AddressInput): AddressInput {
  const out: AddressInput = {};
  for (const f of ADDRESS_FIELDS) out[f] = clean(input[f] as string | null | undefined);
  out.countryIso = out.countryIso ? out.countryIso.toUpperCase() : null;
  out.isBusiness = input.isBusiness ?? null;
  return out;
}

/** True when the payload carries nothing at all — a channel that returned an empty shell. */
export function isEmptyAddress(input: AddressInput): boolean {
  const a = normaliseAddress(input);
  return ADDRESS_FIELDS.every((f) => a[f] == null);
}

/**
 * Whether a sync may write this address.
 *
 * The rule is that a person outranks a channel. Somebody typing an address has almost always done
 * it because the channel's version was absent or wrong, and a nightly sync that reinstates the
 * wrong one — silently, days later, possibly after a label was printed — would make the correction
 * pointless and the cause invisible.
 *
 * So: a channel may create, and may refresh what it itself supplied. It may never overwrite a hand-
 * typed address. Changing one back is a person's decision, taken on the screen, where they can see
 * what they are replacing.
 */
export function channelMayWrite(stored: StoredAddress | null, incoming: AddressInput): boolean {
  // Nothing to write. A channel that answered with an empty address has told us nothing, and
  // storing that would replace a real address with a blank one.
  if (isEmptyAddress(incoming)) return false;
  if (!stored) return true;
  /**
   * Erased is forever.
   *
   * Without this the first sync after a purge would cheerfully re-import the address we had just
   * erased — the order is still there, the marketplace still holds it — and the retention policy
   * would silently do nothing at all while appearing to work. This is the line that makes it real.
   */
  if (stored.purgedAt) return false;
  return stored.source === 'channel';
}

/** What a label needs before a carrier will accept it. */
export const REQUIRED_FOR_LABEL = ['fullName', 'addressLine1', 'city', 'postalCode', 'countryIso'] as const;

/**
 * What is still missing before this order could be shipped on a carrier account.
 *
 * Returned as a list rather than a boolean so the screen can name the gaps. "Incomplete" on its own
 * sends somebody hunting through a form.
 *
 * `postalCode` is required here even though a handful of countries genuinely have none. That is
 * deliberate for now: every destination we actually ship to uses them, and treating the exceptions
 * properly means a country-by-country rule nobody has asked for yet.
 */
export function missingForLabel(a: AddressInput | null): string[] {
  if (!a) return [...REQUIRED_FOR_LABEL];
  const n = normaliseAddress(a);
  return REQUIRED_FOR_LABEL.filter((f) => n[f] == null);
}

// ------------------------------------------------------------------ channel extraction

/**
 * eBay's Sell Fulfillment order → an address.
 *
 * Already in the payload we fetch for every order under the sell.fulfillment.readonly scope we
 * already hold, so this costs no extra call and no new permission. We were reading the country code
 * out of this exact object and discarding the rest.
 */
export function addressFromEbayOrder(o: any): AddressInput {
  const shipTo = o?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo ?? {};
  const c = shipTo.contactAddress ?? {};
  return normaliseAddress({
    fullName: shipTo.fullName ?? null,
    companyName: shipTo.companyName ?? null,
    addressLine1: c.addressLine1 ?? null,
    addressLine2: c.addressLine2 ?? null,
    city: c.city ?? null,
    stateOrRegion: c.stateOrProvince ?? null,
    postalCode: c.postalCode ?? null,
    countryIso: c.countryCode ?? null,
    phone: shipTo.primaryPhone?.phoneNumber ?? null,
    // eBay anonymises buyer email on most marketplaces. Stored when given, never relied on.
    email: shipTo.email ?? null,
  });
}

/**
 * OnBuy's order → an address.
 *
 * NOTE: OnBuy's exact field names inside `delivery_address` are not confirmed against a live
 * payload — only `country_code` is, because that is the one we already read. The alternatives below
 * are the plausible spellings, tried in order.
 *
 * Reading several spellings rather than guessing one is the safer error: a name we do not recognise
 * leaves that field null and visible as a gap on the screen, where a wrong guess would leave the
 * field silently empty and look like an address OnBuy never sent. Confirm against a real order and
 * delete the alternatives.
 */
export function addressFromOnBuyOrder(o: any): AddressInput {
  const d = o?.delivery_address ?? {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = d[k];
      if (typeof v === 'string' && v.trim() !== '') return v;
    }
    return null;
  };
  return normaliseAddress({
    fullName: pick('name', 'full_name', 'recipient_name', 'contact_name'),
    companyName: pick('company', 'company_name'),
    addressLine1: pick('address_line_1', 'address_1', 'line_1', 'street'),
    addressLine2: pick('address_line_2', 'address_2', 'line_2'),
    city: pick('town', 'city', 'town_city'),
    stateOrRegion: pick('county', 'region', 'state', 'province'),
    postalCode: pick('postcode', 'postal_code', 'zip', 'zip_code'),
    countryIso: pick('country_code', 'country_iso', 'country'),
    phone: pick('phone', 'phone_number', 'telephone', 'contact_number'),
    email: pick('email', 'email_address'),
  });
}
