/**
 * Amazon SP-API order → maSquare sales-transaction mapping.
 *
 * Amazon splits an order across two calls: the order header (getOrders) and its
 * line items (getOrderItems). This maps the pair into the shared MappedOrder
 * shape, so the SAME result powers the first-run mapping review and the importer.
 *
 * Money note: SP-API item prices (ItemPrice/ItemTax/ShippingPrice/ShippingTax) are
 * line totals for the ordered quantity. In MOST marketplaces (EU/UK/SG/AE/SA/…) the
 * price is tax-INCLUSIVE, so net = ItemPrice − ItemTax. In "tax added at checkout"
 * marketplaces (US/CA/MX/AU) the price is tax-EXCLUSIVE and the sales tax/GST is added
 * on top — there OrderTotal = ItemPrice + ItemTax, so net = ItemPrice (see TAX_ON_TOP).
 * Amazon referral/FBA fees are NOT in the Orders API — they come from the Finances
 * API — so the sales fee is 0 here and the caller overlays it (see applyAmazonFees).
 */

import type { MappedField, MappedItem, MappedOrder } from './types';

const n = (v: any) => { const x = Number(String(v ?? '').trim()); return Number.isFinite(x) ? x : 0; };
const round2 = (x: number) => Math.round(x * 100) / 100;
const money = (m: any) => n(m?.Amount);

// Amazon marketplaces that display prices tax-EXCLUSIVE and add sales tax/GST on top at
// checkout (OrderTotal = ItemPrice + ItemTax). Confirmed for AU (GST added on top); US/CA/MX
// are Amazon's other tax-exclusive markets. Everywhere else ItemPrice already includes the tax.
const TAX_ON_TOP = new Set(['US', 'CA', 'MX', 'AU']);

/**
 * @param o             one Order object from getOrders
 * @param orderItems    the OrderItems array from getOrderItems for that order
 * @param defaultCountry ISO code to fall back to when the shipping address is
 *                       withheld (Amazon hides it without Restricted Data access);
 *                       the marketplace's own country is a safe domestic default.
 */
/**
 * When a cancelled order was cancelled — before it ever became an order, or after.
 *
 * Amazon reports `OrderStatus: Canceled` for both, so the status alone cannot tell them apart.
 * But Amazon withholds an order's financials while it sits in Pending: no `OrderTotal` on the
 * header, no `ItemPrice` on the items. An order cancelled out of Pending therefore never had
 * those populated, while one that was confirmed and then cancelled keeps them.
 *
 * Verified against two real orders cancelled on the same day:
 *   203-0357262-8533160 — no OrderTotal, no ItemPrice, cancelled 2 minutes after purchase
 *   702-2579052-5535426 — OrderTotal CAD 296.01, ItemPrice CAD 296.01, cancelled 12 hours later
 *
 * `QuantityOrdered` is 0 on BOTH — Amazon zeroes it on cancellation — so quantity is not the
 * signal and must not be used as one.
 *
 * Returns null when the order is not cancelled at all.
 */
export function amazonCancelStage(o: any): 'pending' | 'placed' | null {
  if (String(o?.OrderStatus ?? '') !== 'Canceled') return null;
  // A zero total is still a total; only a missing one means Amazon never confirmed the order.
  const total = o?.OrderTotal?.Amount;
  return total !== undefined && total !== null && String(total).trim() !== '' ? 'placed' : 'pending';
}

export function mapAmazonOrder(o: any, orderItems: any[], defaultCountry: string | null): MappedOrder {
  const status = String(o.OrderStatus ?? '');
  const channelShipmentStatus: 'shipped' | 'not_shipped' = status === 'Shipped' ? 'shipped' : 'not_shipped';
  const resolution: 'none' | 'cancelled' = status === 'Canceled' ? 'cancelled' : 'none';
  const cancelStage = resolution === 'cancelled' ? amazonCancelStage(o) : null;
  // FulfillmentChannel: AFN = Amazon (FBA), MFN = merchant (FBM).
  const fc = String(o.FulfillmentChannel ?? '');
  const fulfilmentType: 'FBA' | 'FBM' | null = fc === 'AFN' ? 'FBA' : fc === 'MFN' ? 'FBM' : null;
  const destCode = o.ShippingAddress?.CountryCode ?? defaultCountry ?? null;
  const currency = o.OrderTotal?.CurrencyCode ?? orderItems[0]?.ItemPrice?.CurrencyCode ?? null;

  const header: MappedField[] = [
    { target: 'transactionRef', label: 'Transaction ID', source: 'AmazonOrderId', value: o.AmazonOrderId ?? null },
    { target: 'date', label: 'Date', source: 'PurchaseDate', value: o.PurchaseDate ?? null },
    { target: 'currency', label: 'Currency', source: 'OrderTotal.CurrencyCode', value: currency },
    { target: 'destinationCountry', label: 'Destination country', source: 'ShippingAddress.CountryCode (or marketplace)', value: destCode },
    { target: 'fulfilmentType', label: 'Fulfilment type', source: 'FulfillmentChannel (AFN→FBA, MFN→FBM)', value: fulfilmentType },
    { target: 'channelShipmentStatus', label: 'Channel shipment status', source: 'OrderStatus', value: channelShipmentStatus },
    { target: 'resolution', label: 'Resolution', source: 'OrderStatus', value: resolution },
    { target: 'cancelStage', label: 'Cancelled at', source: 'OrderTotal (absent while Pending)', value: cancelStage },
  ];

  const items: MappedItem[] = (orderItems ?? []).map((it: any) => {
    const gross = money(it.ItemPrice);
    const tax = money(it.ItemTax);
    const shippingGross = money(it.ShippingPrice);
    const shippingTax = money(it.ShippingTax);
    // Only the tax-on-top markets (US/CA/MX/AU: US sales tax / GST) display prices tax-EXCLUSIVE
    // and add the tax at checkout, so there net sales = ItemPrice. EVERYWHERE ELSE — including
    // Japan — the listed price is tax-INCLUSIVE, so net = ItemPrice − ItemTax (e.g. a ¥12,520
    // JP price is ¥11,593 net + ¥927 JCT). The tax amount is recorded in `vat` and the
    // transaction's `taxType` (from the destination country) tells reports which tax it is
    // (VAT / GST / JCT) so a VAT return never double-counts a non-VAT tax. Japan differs from
    // EU VAT in that Amazon does NOT remit the JCT for the seller — the seller receives the
    // full tax-inclusive amount — but that only affects the profit calc, not this split.
    const isJp = defaultCountry === 'JP';
    const taxOnTop = defaultCountry ? TAX_ON_TOP.has(defaultCountry) : false;
    const netSales = round2(taxOnTop ? gross : gross - tax);
    const vat = tax;
    const shipping = round2(taxOnTop ? shippingGross : shippingGross - shippingTax);
    const shipVat = shippingTax;
    // Total tax the channel charged (item + shipping) — mirror of the destination tax, kept for
    // reporting.
    const salesTax = round2(tax + shippingTax);
    // Amazon Points awarded — a JP-only loyalty program the seller funds, so it's a deduction from
    // proceeds. Only the JP marketplace returns PointsGranted; gate on JP so it never applies elsewhere.
    const points = isJp ? round2(money(it.PointsGranted?.PointsMonetaryValue)) : 0;
    const quantity = n(it.QuantityOrdered) || 1;
    const sku = it.SellerSKU ?? null;
    return {
      sku,
      fields: [
        { target: 'sku', label: 'SKU', source: 'OrderItems[].SellerSKU', value: sku },
        { target: 'quantity', label: 'Quantity', source: 'OrderItems[].QuantityOrdered', value: quantity },
        { target: 'netSalesAmount', label: 'Net sales', source: taxOnTop ? 'ItemPrice (tax added on top)' : 'ItemPrice − ItemTax', value: netSales },
        { target: 'vatAmount', label: isJp ? 'Consumption tax' : 'VAT/GST', source: 'OrderItems[].ItemTax', value: vat },
        { target: 'shippingAmount', label: 'Shipping', source: taxOnTop ? 'ShippingPrice (tax added on top)' : 'ShippingPrice − ShippingTax', value: shipping },
        { target: 'shippingAmountVat', label: isJp ? 'Shipping consumption tax' : 'Shipping VAT/GST', source: 'OrderItems[].ShippingTax', value: shipVat },
        { target: 'salesChannelSalesFeeAmount', label: 'Sales fee (referral)', source: 'Finances API — non-FBA ItemFeeList', value: 0 },
        { target: 'fbaFulfilmentFeeAmount', label: 'FBA fulfilment fee', source: 'Finances API — FBA* ItemFeeList', value: 0 },
        { target: 'amazonPointsAmount', label: 'Amazon points awarded', source: 'OrderItems[].PointsGranted.PointsMonetaryValue', value: points },
        { target: 'salesTaxAmount', label: 'Tax charged (reporting)', source: 'ItemTax + ShippingTax', value: salesTax },
      ],
      payload: { sku, quantity, netSalesAmount: netSales, vatAmount: vat, shippingAmount: shipping, shippingAmountVat: shipVat, salesChannelSalesFeeAmount: 0, fbaFulfilmentFeeAmount: 0, amazonPointsAmount: points, salesTaxAmount: salesTax },
    };
  });

  return {
    orderId: o.AmazonOrderId,
    header,
    items,
    payload: { transactionRef: o.AmazonOrderId, date: o.PurchaseDate, currency, destinationCountryCode: destCode, channelShipmentStatus, resolution, fulfilmentType },
    raw: { ...o, OrderItems: orderItems },
  };
}
