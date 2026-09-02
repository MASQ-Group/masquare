/**
 * How a sales transaction's columns read in its history tab.
 *
 * Money and tax dominate deliberately: an order's history is consulted when a figure looks wrong,
 * and "VAT 0.00 → 23.05" or "Resolution none → cancelled" is the answer, where "someone edited
 * this order" is not.
 */
export const SALES_TX_FIELD_LABELS: Record<string, string> = {
  date: 'Date',
  transactionRef: 'Transaction ID',
  salesChannelId: 'Sales channel',
  destinationCountryId: 'Destination',
  companyId: 'Company',
  currency: 'Currency',
  feeCurrency: 'Fee currency',
  exchangeRate: 'Exchange rate',
  feeExchangeRate: 'Fee exchange rate',
  status: 'Status',
  unlockedForEdit: 'Unlocked for edit',
  shippingServiceId: 'Shipping service',
  destinationVatPct: 'Destination VAT %',
  vatOverridden: 'VAT overridden',
  taxType: 'Tax type',
  fulfilmentStatus: 'Fulfilment status',
  channelShipmentStatus: 'Channel shipment status',
  fulfilmentType: 'Fulfilment type',
  deliveryMethod: 'Delivery method',
  localShippingCostEur: 'Local shipping cost',
  discountType: 'Discount type',
  discountValue: 'Discount value',
  discountBase: 'Discount base',
  resolution: 'Resolution',
  resolutionNotes: 'Resolution notes',
  resolutionSource: 'Resolution source',
  cancelStage: 'Cancelled at',
  restockItems: 'Restock items',
  feeRefunded: 'Fee refunded',
  refundAmount: 'Refund amount',
  returnHandled: 'Return handled',
  returnWarehouseId: 'Return warehouse',
};

/** Reference columns holding ids, and the table each points at — resolved to names for display. */
export const SALES_TX_REF_FIELDS = {
  salesChannelId: 'salesChannel',
  destinationCountryId: 'country',
  companyId: 'company',
  shippingServiceId: 'shippingService',
  returnWarehouseId: 'warehouse',
} as const;

/**
 * Countries and companies do not have a `name` column shaped like the others, so the resolver needs
 * to know which field carries the display name for each table.
 */
export const SALES_TX_REF_NAME_FIELD: Record<string, string> = {
  country: 'name',
  company: 'officialName',
  salesChannel: 'name',
  shippingService: 'name',
  warehouse: 'name',
};
