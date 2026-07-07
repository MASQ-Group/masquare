/**
 * OnBuy order → maSquare sales-transaction mapping.
 *
 * Kept pure and declarative so the SAME logic powers (a) the first-run mapping
 * verification the user reviews and (b) the importer that writes transactions —
 * they can never drift apart. Each field records where it came from (`source`)
 * so the verification UI can show target ← source = value.
 */

export interface MappedField {
  target: string; // maSquare field
  label: string;
  source: string; // OnBuy field / derivation
  value: string | number | null;
  resolved?: string | null; // e.g. country name looked up from a code
}

export interface MappedItem {
  sku: string | null;
  fields: MappedField[];
  // Machine payload for the importer.
  payload: {
    sku: string | null; quantity: number;
    netSalesAmount: number; vatAmount: number;
    shippingAmount: number; shippingAmountVat: number;
    salesChannelSalesFeeAmount: number;
  };
}

export interface MappedOrder {
  orderId: string;
  header: MappedField[];
  items: MappedItem[];
  // Machine payload (header) for the importer.
  payload: {
    transactionRef: string; date: string; currency: string | null;
    destinationCountryCode: string | null; channelShipmentStatus: 'shipped' | 'not_shipped';
    resolution: 'none' | 'cancelled';
  };
  raw: any;
}

const n = (v: any) => { const x = Number(String(v ?? '').trim()); return Number.isFinite(x) ? x : 0; };
const round2 = (x: number) => Math.round(x * 100) / 100;

export function mapOnBuyOrder(o: any): MappedOrder {
  const shipped = !!o.shipped_at || o.dispatched === true || o.dispatched === 1 || o.dispatched === '1';
  const cancelled = !!o.cancelled_at || String(o.status ?? '').toLowerCase().includes('cancel');
  const channelShipmentStatus: 'shipped' | 'not_shipped' = shipped ? 'shipped' : 'not_shipped';
  const resolution: 'none' | 'cancelled' = cancelled ? 'cancelled' : 'none';

  const header: MappedField[] = [
    { target: 'transactionRef', label: 'Transaction ID', source: 'order_id', value: o.order_id ?? null },
    { target: 'date', label: 'Date', source: 'date', value: o.date ?? null },
    { target: 'currency', label: 'Currency', source: 'currency_code', value: o.currency_code ?? null },
    { target: 'destinationCountry', label: 'Destination country', source: 'delivery_address.country_code', value: o.delivery_address?.country_code ?? null },
    { target: 'channelShipmentStatus', label: 'Channel shipment status', source: 'shipped_at / dispatched', value: channelShipmentStatus },
    { target: 'resolution', label: 'Resolution', source: 'status / cancelled_at', value: resolution },
  ];

  const items: MappedItem[] = (o.products ?? []).map((p: any) => {
    const taxProduct = n(p.tax?.tax_product);
    const taxDelivery = n(p.tax?.tax_delivery);
    const totalPrice = n(p.total_price);
    const delivery = n(p.price_delivery_total);
    const fee = n(p.fee?.total_sales_fee);
    const netSales = round2(totalPrice - taxProduct);
    const shipping = round2(delivery - taxDelivery);
    const quantity = n(p.quantity) || 1;
    return {
      sku: p.sku ?? null,
      fields: [
        { target: 'sku', label: 'SKU', source: 'products[].sku', value: p.sku ?? null },
        { target: 'quantity', label: 'Quantity', source: 'products[].quantity', value: quantity },
        { target: 'netSalesAmount', label: 'Net sales (ex VAT)', source: 'total_price − tax.tax_product', value: netSales },
        { target: 'vatAmount', label: 'VAT', source: 'products[].tax.tax_product', value: taxProduct },
        { target: 'shippingAmount', label: 'Shipping (ex VAT)', source: 'price_delivery_total − tax_delivery', value: shipping },
        { target: 'shippingAmountVat', label: 'Shipping VAT', source: 'products[].tax.tax_delivery', value: taxDelivery },
        { target: 'salesChannelSalesFeeAmount', label: 'Sales fee (actual)', source: 'products[].fee.total_sales_fee', value: fee },
      ],
      payload: { sku: p.sku ?? null, quantity, netSalesAmount: netSales, vatAmount: taxProduct, shippingAmount: shipping, shippingAmountVat: taxDelivery, salesChannelSalesFeeAmount: fee },
    };
  });

  return {
    orderId: o.order_id,
    header,
    items,
    payload: { transactionRef: o.order_id, date: o.date, currency: o.currency_code ?? null, destinationCountryCode: o.delivery_address?.country_code ?? null, channelShipmentStatus, resolution },
    raw: o,
  };
}
