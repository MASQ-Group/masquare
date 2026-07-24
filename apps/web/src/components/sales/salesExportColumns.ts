import type { SalesTransaction, SalesTransactionItem } from '../../lib/api';

type Cell = string | number | null;

export interface TxExportColumn {
  key: string;
  label: string;
  get: (t: SalesTransaction) => Cell;
  /** Included by default. */
  def?: boolean;
}

export interface ItemExportColumn {
  key: string;
  label: string;
  get: (it: SalesTransactionItem, t: SalesTransaction) => Cell;
  def?: boolean;
}

const num = (v: number | null | undefined): Cell => (v == null ? null : Number(v));
const deliveryLabel: Record<string, string> = { pickup: 'Pickup', own_delivery: 'Own delivery' };

/** Transaction-level columns (one value per transaction). */
export const TX_EXPORT_COLUMNS: TxExportColumn[] = [
  { key: 'date', label: 'Date', def: true, get: (t) => t.date.slice(0, 10) },
  { key: 'ref', label: 'Transaction ID', def: true, get: (t) => t.transactionRef },
  { key: 'status', label: 'Status', def: true, get: (t) => t.status },
  { key: 'channel', label: 'Sales channel', def: true, get: (t) => t.salesChannel?.name ?? '' },
  { key: 'type', label: 'Channel type', def: false, get: (t) => (t.isLocal ? 'Local' : 'Online') },
  { key: 'destination', label: 'Destination', def: false, get: (t) => t.destinationCountry?.name ?? '' },
  { key: 'currency', label: 'Currency', def: false, get: (t) => t.currency ?? '' },
  { key: 'fx', label: 'Exchange rate', def: false, get: (t) => num(t.exchangeRate) },
  { key: 'delivery', label: 'Delivery method', def: false, get: (t) => (t.deliveryMethod ? deliveryLabel[t.deliveryMethod] : '') },
  { key: 'deliveryCost', label: 'Delivery cost to us', def: false, get: (t) => num(t.localShippingCostEur) },
  { key: 'skuCount', label: 'SKU count', def: true, get: (t) => t.itemCount },
  { key: 'qty', label: 'Total qty', def: false, get: (t) => t.totals.quantity },
  { key: 'netSales', label: 'Net sales', def: true, get: (t) => num(t.totals.netSales) },
  { key: 'vat', label: 'VAT', def: true, get: (t) => num(t.totals.vat) },
  { key: 'shipping', label: 'Shipping (customer)', def: false, get: (t) => num(t.totals.shipping) },
  { key: 'shippingVat', label: 'Shipping VAT', def: false, get: (t) => num(t.totals.shippingVat) },
  { key: 'total', label: 'Total', def: true, get: (t) => num(t.transactionTotal) },
  { key: 'discountType', label: 'Discount type', def: false, get: (t) => t.discountType ?? '' },
  { key: 'discountValue', label: 'Discount value', def: false, get: (t) => num(t.discountValue) },
  { key: 'salesFee', label: 'Sales fee', def: false, get: (t) => num(t.effectiveSalesFee) },
  { key: 'estShip', label: 'Est. shipping cost', def: false, get: (t) => num(t.estimatedShippingCost) },
  { key: 'profit', label: 'Profit (EUR)', def: true, get: (t) => num(t.profit) },
  { key: 'profitPct', label: 'Profit (%)', def: true, get: (t) => num(t.profitPct) },
  { key: 'fulfilment', label: 'Fulfilment', def: false, get: (t) => t.fulfilmentType ?? '' },
  { key: 'shipped', label: 'Shipment', def: false, get: (t) => (t.shipped ? 'Shipped' : 'Not shipped') },
  { key: 'resolution', label: 'Resolution', def: false, get: (t) => t.resolution },
  { key: 'alerts', label: 'Alerts', def: false, get: (t) => (t.alerts.length ? t.alerts.map((a) => a.message).join(' | ') : '') },
];

/** SKU-line columns, used when the export expands one row per SKU. */
export const ITEM_EXPORT_COLUMNS: ItemExportColumn[] = [
  { key: 'sku', label: 'SKU', def: true, get: (it) => it.sku },
  { key: 'productTitle', label: 'Product', def: true, get: (it) => it.productTitle ?? '' },
  { key: 'matched', label: 'In catalogue', def: false, get: (it) => (it.productMatched ? 'Yes' : 'No') },
  { key: 'quantity', label: 'Qty', def: true, get: (it) => it.quantity },
  {
    key: 'unitNet', label: 'Unit net price', def: true,
    get: (it) => (it.netSalesAmount != null && it.quantity ? Number((it.netSalesAmount / it.quantity).toFixed(2)) : null),
  },
  { key: 'lineNet', label: 'Line net', def: true, get: (it) => num(it.netSalesAmount) },
  { key: 'vatRate', label: 'VAT %', def: false, get: (it) => num(it.vatRatePct) },
  { key: 'vatClass', label: 'VAT class', def: false, get: (it) => it.vatClass?.name ?? '' },
  { key: 'vatAmount', label: 'VAT amount', def: true, get: (it) => num(it.vatAmount) },
  { key: 'lineTotal', label: 'Line total', def: false, get: (it) => Number(((it.netSalesAmount ?? 0) + (it.vatAmount ?? 0)).toFixed(2)) },
  // The cost COGS actually used — average once received, catalogue before that, or the
  // override. Exporting anything else would not reconcile to the exported profit.
  { key: 'unitCost', label: 'Unit cost', def: false, get: (it) => num(it.unitCostEur ?? it.unitNetCostEur ?? it.productCost) },
  { key: 'costSource', label: 'Unit cost source', def: false, get: (it) => it.costSource ?? '' },
  { key: 'averageCost', label: 'Average cost', def: false, get: (it) => num(it.averageCostEur) },
  { key: 'catalogueCost', label: 'Catalogue cost', def: false, get: (it) => num(it.productCost) },
  { key: 'costOverride', label: 'Unit cost override', def: false, get: (it) => num(it.unitNetCostEur) },
];
