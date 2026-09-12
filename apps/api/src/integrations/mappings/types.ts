/**
 * Shared shapes for channel order → maSquare sales-transaction mappings.
 *
 * Kept in one place so every connector's mapping (OnBuy, Amazon, …) produces the
 * identical structure: the SAME object powers (a) the first-run mapping review the
 * user confirms and (b) the importer that writes transactions — they cannot drift.
 * Each field records where it came from (`source`) so the review UI can show
 * target ← source = value.
 */

export interface MappedField {
  target: string; // maSquare field
  label: string;
  source: string; // channel field / derivation
  /** `unknown` because a raw channel block travels through here too; the rest are scalars. */
  value: string | number | boolean | null | unknown;
  resolved?: string | null; // e.g. country name looked up from a code
}

export interface MappedItemPayload {
  sku: string | null;
  quantity: number;
  netSalesAmount: number;
  vatAmount: number;
  shippingAmount: number;
  shippingAmountVat: number;
  salesChannelSalesFeeAmount: number; // referral / selling fee (excludes FBA fulfilment)
  fbaFulfilmentFeeAmount: number;     // Amazon FBA fulfilment fee (0 for non-FBA)
  amazonPointsAmount: number;         // Amazon Points awarded (JP) — a deduction from proceeds
  salesTaxAmount: number;             // total tax the channel charged (reporting only)
  /**
   * The channel REPORTED that it collected and remits this line's tax — not something we inferred.
   *
   * Amazon says so in `TaxCollection.Model = MarketplaceFacilitator`; eBay by returning
   * `ebayCollectAndRemitTaxes`. Both are statements of fact from the party that took the money, and
   * they are the only trustworthy source: deriving it from a threshold rule instead would make the
   * platform's own configuration decide who owes HMRC, and would be silently wrong the moment a
   * marketplace changed its policy or a rule was edited after the fact.
   */
  channelReportedTaxCollection: boolean;
  /**
   * The channel's tax fields verbatim, before anything above interpreted them.
   *
   * Every other figure here is an answer to a question somebody already knew to ask. This is for
   * the ones nobody did: whether a zero was reported or simply absent, what `TaxCollection` said
   * when the tax was nil, which field the money was actually in. `money()` flattens absent and zero
   * to the same number, and that collapse is what makes a tenth of Amazon's orders unexplainable.
   *
   * Diagnostic only, and deliberately untyped beyond `unknown` — giving a channel's payload a shape
   * here would be promising to keep that shape.
   */
  channelTaxRaw?: { [key: string]: unknown };
}

export interface MappedItem {
  sku: string | null;
  fields: MappedField[];
  payload: MappedItemPayload; // machine payload for the importer
}

export interface MappedOrderPayload {
  transactionRef: string;
  date: string;
  currency: string | null;
  destinationCountryCode: string | null;
  channelShipmentStatus: 'shipped' | 'not_shipped';
  resolution: 'none' | 'cancelled';
  fulfilmentType: 'FBA' | 'FBM' | null; // channel fulfilment (Amazon AFN/MFN); null where N/A
  // For multi-marketplace channels (eBay: one account sells across eBay UK/AU/DE/… with
  // different currencies), the ISO country of the marketplace the order was placed on. Used to
  // route the transaction to the matching per-country sales channel. Null → use the default.
  marketplaceCountryCode?: string | null;
  /**
   * Whether the channel called it a business order. Null where the channel does not say — which is
   * every channel but Amazon, and Amazon too when it has no opinion.
   */
  isBusinessOrder?: boolean | null;
}

export interface MappedOrder {
  orderId: string;
  header: MappedField[];
  items: MappedItem[];
  payload: MappedOrderPayload; // machine payload (header) for the importer
  raw: any;
}
