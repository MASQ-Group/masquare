/**
 * eBay Sell Fulfillment API order → maSquare sales-transaction mapping.
 *
 * Money model (verified against live GB orders 2026-07-26):
 *  - `lineItem.total` / `pricingSummary.priceSubtotal` / `pricingSummary.total` are the seller's
 *    NET item price — ex the VAT eBay collects. (e.g. 62.50 net; buyer actually paid 62.50 + 12.50.)
 *  - `ebayCollectAndRemitTaxes` is VAT eBay collected from the buyer and REMITS on the seller's
 *    behalf (UK marketplace facilitator / IOSS). The seller owes nothing on it → seller VAT = 0,
 *    and the collected amount is reporting-only (salesTaxAmount). Mirrors Amazon's collected VAT.
 *  - Where eBay does NOT collect and the destination is in the EU VAT zone, the seller owes the
 *    VAT. eBay hands over the whole amount the buyer paid, so `lineItem.total` is GROSS there,
 *    not net — verified against live eBay DE orders, where the recorded total matches the listed
 *    (tax-inclusive) price to the cent. The VAT is extracted here, at the DESTINATION country's
 *    rate: a sale on eBay DE shipped to Greece is 24%, not Germany's 19%.
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

/** eBay marketplace id (e.g. "EBAY_AU", "EBAY_GB", "EBAY_MOTORS") → ISO country code, so an
 *  order can be routed to the matching per-country sales channel. */
export function ebayMarketplaceToIso(mp?: string | null): string | null {
  if (!mp) return null;
  const s = String(mp).replace(/^EBAY_/, '').toUpperCase();
  if (s === 'MOTORS') return 'US'; // eBay Motors is the US marketplace
  return /^[A-Z]{2}$/.test(s) ? s : (/^[A-Z]{2}/.test(s) ? s.slice(0, 2) : null); // e.g. CA_FR → CA
}

/** What the destination country charges. Supplied by the caller — the mapper has no database. */
export interface DestinationVat {
  euVatZone: boolean;
  /** Percent, e.g. 19 for Germany. */
  vatRate: number;
}

export function mapEbayOrder(o: any, vatForCountry?: (iso: string) => DestinationVat | null): MappedOrder {
  const orderId = String(o.orderId ?? o.legacyOrderId ?? '');
  const currency = o?.pricingSummary?.total?.currency ?? o?.pricingSummary?.priceSubtotal?.currency ?? null;
  const destCode = o?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo?.contactAddress?.countryCode ?? null;
  const channelShipmentStatus: 'shipped' | 'not_shipped' = String(o.orderFulfillmentStatus ?? '') === 'FULFILLED' ? 'shipped' : 'not_shipped';
  const resolution: 'none' | 'cancelled' = String(o?.cancelStatus?.cancelState ?? '') === 'CANCELED' ? 'cancelled' : 'none';

  // The marketplace the order was placed on (per line item; an order is single-marketplace).
  const marketplaceId = (o.lineItems ?? [])[0]?.listingMarketplaceId ?? (o.lineItems ?? [])[0]?.purchaseMarketplaceId ?? null;
  const marketplaceCountryCode = ebayMarketplaceToIso(marketplaceId);

  // The rate we owe, if any. Null when the destination is outside the EU VAT zone, unknown, or
  // the caller supplied no lookup — in every one of those cases nothing is extracted, because a
  // guessed VAT rate is worse than a visible zero.
  const destVat = destCode ? vatForCountry?.(destCode) ?? null : null;
  const owedVatPct = destVat && destVat.euVatZone && destVat.vatRate > 0 ? destVat.vatRate : null;

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
    { target: 'salesChannel', label: 'eBay marketplace', source: 'lineItem.listingMarketplaceId', value: marketplaceId, resolved: marketplaceCountryCode },
    { target: 'currency', label: 'Currency', source: 'pricingSummary.total.currency', value: currency },
    { target: 'destinationCountry', label: 'Destination country', source: 'shipTo.contactAddress.countryCode', value: destCode },
    { target: 'fulfilmentType', label: 'Fulfilment type', source: 'eBay is seller-fulfilled', value: null },
    { target: 'channelShipmentStatus', label: 'Channel shipment status', source: 'orderFulfillmentStatus', value: channelShipmentStatus },
    { target: 'resolution', label: 'Resolution', source: 'cancelStatus.cancelState', value: resolution },
  ];

  const items: MappedItem[] = lines.map((li, i) => {
    const lineTotal = round2(money(li.total));
    const shippingTotal = round2(money(li?.deliveryCost?.shippingCost));
    const collectedVat = round2(((li.ebayCollectAndRemitTaxes ?? []) as any[]).reduce((s, t) => s + money(t.amount), 0));

    // Who owes the VAT decides whether the line total is net or gross.
    //
    // eBay collected it (UK facilitator, IOSS): eBay added the tax ON TOP of our price and remits
    // it, so the total is already net and we owe nothing. This branch wins even for an EU
    // destination — an IOSS-collected import is settled by eBay, not by us.
    //
    // eBay did not collect and the destination is in the EU VAT zone: eBay passes on everything
    // the buyer paid, so the total is gross and the VAT inside it is ours to remit.
    const extractPct = collectedVat > 0 ? null : owedVatPct;
    const split = (gross: number) => {
      if (extractPct == null) return { net: gross, vat: 0 };
      const netPart = round2(gross / (1 + extractPct / 100));
      // Derive the VAT by subtraction so net + vat always reconciles to what the buyer paid;
      // computing both independently leaves a cent adrift on some amounts.
      return { net: netPart, vat: round2(gross - netPart) };
    };
    const goods = split(lineTotal);
    const ship = split(shippingTotal);

    const fee = feeFor(i);
    const qty = n(li.quantity);
    const vatSource = extractPct == null
      ? 'eBay remits the VAT → 0'
      : `extracted at the destination rate (${extractPct}%)`;
    return {
      sku: li.sku ?? null,
      fields: [
        { target: 'sku', label: 'SKU', source: 'lineItem.sku', value: li.sku ?? null },
        { target: 'quantity', label: 'Quantity', source: 'lineItem.quantity', value: qty },
        { target: 'netSalesAmount', label: 'Net sales', source: extractPct == null ? 'lineItem.total (ex marketplace VAT)' : 'lineItem.total − VAT (total is gross)', value: goods.net },
        { target: 'vatAmount', label: 'VAT (seller-owed)', source: vatSource, value: goods.vat },
        { target: 'salesChannelSalesFeeAmount', label: 'eBay fee', source: 'totalMarketplaceFee (allocated)', value: fee },
        { target: 'shippingAmount', label: 'Buyer-paid shipping', source: 'lineItem.deliveryCost.shippingCost', value: ship.net },
        { target: 'shippingAmountVat', label: 'Shipping VAT (seller-owed)', source: vatSource, value: ship.vat },
        { target: 'salesTaxAmount', label: 'VAT collected by eBay', source: 'ebayCollectAndRemitTaxes (reporting)', value: collectedVat },
      ],
      payload: {
        sku: li.sku ?? null,
        quantity: qty,
        netSalesAmount: goods.net,
        vatAmount: goods.vat,
        shippingAmount: ship.net,
        shippingAmountVat: ship.vat,
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
      marketplaceCountryCode,
    },
    raw: o,
  };
}
