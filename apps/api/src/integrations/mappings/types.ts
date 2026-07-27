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
  value: string | number | null;
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
}

export interface MappedOrder {
  orderId: string;
  header: MappedField[];
  items: MappedItem[];
  payload: MappedOrderPayload; // machine payload (header) for the importer
  raw: any;
}
