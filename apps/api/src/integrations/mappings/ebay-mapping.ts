/**
 * eBay Sell Fulfillment API order → maSquare sales-transaction mapping.
 *
 * Money model (verified against live GB orders 2026-07-26):
 *  - `lineItem.total` / `pricingSummary.priceSubtotal` / `pricingSummary.total` are the seller's
 *    NET item price — ex the VAT eBay collects. (e.g. 62.50 net; buyer actually paid 62.50 + 12.50.)
 *  - `ebayCollectAndRemitTaxes` is VAT eBay collected from the buyer and REMITS on the seller's
 *    behalf (UK marketplace facilitator / IOSS). The seller owes nothing on it → seller VAT = 0,
 *    and the collected amount is reporting-only (salesTaxAmount). Mirrors Amazon's collected VAT.
 *  - `totalMarketplaceFee` is eBay's selling fee for the whole order (present on the order itself,
 *    unlike Amazon where fees need the Finances API) — allocated across lines by net.
 *  - `deliveryCost.shippingCost` is buyer-paid shipping.
 *
 * Amounts stay in the order's native currency; the sales-transaction layer converts to EUR via FX.
 */

import type { MappedField, MappedItem, MappedOrder } from './types';

const n = (v: any) => { const x = Number(String(v ?? '').trim()); return Number.isFinite(x) ? x : 0; };
const round2 = (x: number) => Math.round(x * 100) / 100;
const money = (m: any) => n(m?.value);

export function mapEbayOrder(o: any): MappedOrder {
  const orderId = String(o.orderId ?? o.legacyOrderId ?? '');
  const currency = o?.pricingSummary?.total?.currency ?? o?.pricingSummary?.priceSubtotal?.currency ?? null;
  const destCode = o?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo?.contactAddress?.countryCode ?? null;
  const channelShipmentStatus: 'shipped' | 'not_shipped' = String(o.orderFulfillmentStatus ?? '') === 'FULFILLED' ? 'shipped' : 'not_shipped';
  const resolution: 'none' | 'cancelled' = String(o?.cancelStatus?.cancelState ?? '') === 'CANCELED' ? 'cancelled' : 'none';

  const lines = (o.lineItems ?? []) as any[];
  const nets = lines.map((li) => money(li.total));
  const sumNet = nets.reduce((s, x) => s + x, 0);
  const totalFee = money(o.totalMarketplaceFee);
  // Allocate the order-level eBay fee across lines by net, absorbing rounding on the last line.
  let feeAllocated = 0;
  const feeFor = (i: number) => {
    if (i === lines.length - 1) return round2(totalFee - feeAllocated);
    const f = sumNet > 0 ? round2(totalFee * (nets[i] / sumNet)) : 0;
    feeAllocated = round2(feeAllocated + f);
    return f;
  };

  const header: MappedField[] = [
    { target: 'transactionRef', label: 'Transaction ID', source: 'orderId', value: orderId },
    { target: 'date', label: 'Date', source: 'creationDate', value: o.creationDate ?? null },
    { target: 'currency', label: 'Currency', source: 'pricingSummary.total.currency', value: currency },
    { target: 'destinationCountry', label: 'Destination country', source: 'shipTo.contactAddress.countryCode', value: destCode },
    { target: 'fulfilmentType', label: 'Fulfilment type', source: 'eBay is seller-fulfilled', value: null },
    { target: 'channelShipmentStatus', label: 'Channel shipment status', source: 'orderFulfillmentStatus', value: channelShipmentStatus },
    { target: 'resolution', label: 'Resolution', source: 'cancelStatus.cancelState', value: resolution },
  ];

  const items: MappedItem[] = lines.map((li, i) => {
    const net = round2(money(li.total));
    const shipping = round2(money(li?.deliveryCost?.shippingCost));
    const collectedVat = round2(((li.ebayCollectAndRemitTaxes ?? []) as any[]).reduce((s, t) => s + money(t.amount), 0));
    const fee = feeFor(i);
    const qty = n(li.quantity);
    return {
      sku: li.sku ?? null,
      fields: [
        { target: 'sku', label: 'SKU', source: 'lineItem.sku', value: li.sku ?? null },
        { target: 'quantity', label: 'Quantity', source: 'lineItem.quantity', value: qty },
        { target: 'netSalesAmount', label: 'Net sales', source: 'lineItem.total (ex marketplace VAT)', value: net },
        { target: 'vatAmount', label: 'VAT (seller-owed)', source: 'eBay remits the VAT → 0', value: 0 },
        { target: 'salesChannelSalesFeeAmount', label: 'eBay fee', source: 'totalMarketplaceFee (allocated)', value: fee },
        { target: 'shippingAmount', label: 'Buyer-paid shipping', source: 'lineItem.deliveryCost.shippingCost', value: shipping },
        { target: 'salesTaxAmount', label: 'VAT collected by eBay', source: 'ebayCollectAndRemitTaxes (reporting)', value: collectedVat },
      ],
      payload: {
        sku: li.sku ?? null,
        quantity: qty,
        netSalesAmount: net,
        vatAmount: 0,
        shippingAmount: shipping,
        shippingAmountVat: 0,
        salesChannelSalesFeeAmount: fee,
        fbaFulfilmentFeeAmount: 0,
        amazonPointsAmount: 0,
        salesTaxAmount: collectedVat,
      },
    };
  });

  return {
    orderId,
    header,
    items,
    payload: {
      transactionRef: orderId,
      date: o.creationDate ?? '',
      currency,
      destinationCountryCode: destCode,
      channelShipmentStatus,
      resolution,
      fulfilmentType: null,
    },
    raw: o,
  };
}
