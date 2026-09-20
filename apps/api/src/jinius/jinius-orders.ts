/**
 * Reading Jinius (Mirakl) orders, and what they mean for stock and for the local invoice.
 *
 * These orders are deliberately NOT sales transactions. Accounting issues a local invoice for them —
 * they are Cyprus sales — and that invoice is entered here as a local transaction, which is what the
 * revenue and profit reports count. An order imported as a transaction as well would be counted
 * twice, so it is kept as an order: visible, matched to products, able to lower availability, and
 * linked to the transaction that invoices it.
 *
 * PURE.
 */

/** Mirakl's order states, as OR11 documents them. */
export const JINIUS_ORDER_STATES = [
  'STAGING', 'WAITING_ACCEPTANCE', 'WAITING_DEBIT', 'WAITING_DEBIT_PAYMENT',
  'SHIPPING', 'SHIPPED', 'TO_COLLECT', 'RECEIVED', 'CLOSED', 'REFUSED', 'CANCELED',
] as const;

/**
 * The states where the goods are ours to send, so their units leave the shared availability pool.
 *
 * An order still waiting for acceptance may never happen, and a refused or cancelled one never did;
 * deducting for those would quietly eat availability every other channel is told about.
 */
export const STATES_THAT_HOLD_STOCK = new Set(['SHIPPING', 'SHIPPED', 'TO_COLLECT', 'RECEIVED', 'CLOSED']);

/** The states worth pulling at all: everything except the basket Mirakl has not finished writing. */
export const STATES_WORTH_PULLING = JINIUS_ORDER_STATES.filter((s) => s !== 'STAGING');

export const holdsStock = (state: string | null | undefined): boolean => STATES_THAT_HOLD_STOCK.has((state ?? '').toUpperCase());

/** An order that is dead — its units, if ever taken, come back. */
export const isDead = (state: string | null | undefined): boolean => ['REFUSED', 'CANCELED'].includes((state ?? '').toUpperCase());

export interface JiniusOrderLineRead {
  orderLineId: string;
  offerSku: string;
  productTitle: string | null;
  quantity: number;
  /** Line price without shipping, as Mirakl reports it. */
  price: number;
  unitPrice: number | null;
  shippingPrice: number;
  /** Commission plus the VAT on it — everything Jinius keeps for this line. */
  totalCommission: number;
  /** The tax inside the line's price, where Mirakl reported one. */
  taxAmount: number;
  state: string | null;
}

export interface JiniusOrderRead {
  orderId: string;
  commercialId: string | null;
  orderedAt: Date | null;
  state: string;
  currency: string;
  taxMode: string | null;
  priceTotal: number;
  shippingPrice: number;
  totalCommission: number;
  totalPrice: number;
  lines: JiniusOrderLineRead[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const sumAmounts = (v: unknown): number =>
  Array.isArray(v) ? v.reduce((t: number, x: any) => t + num(x?.amount), 0) : 0;

/**
 * One page of OR11 as orders and their lines.
 *
 * Mirakl reports commission per line and again as an order total; both are kept, because the local
 * invoice takes the fee off line by line while a person reconciling a payout reads the order total.
 * A line with no `offer_sku` is dropped: without our own SKU it matches no product here.
 */
export function readJiniusOrders(json: unknown): JiniusOrderRead[] {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const orders: any[] = Array.isArray(body?.orders) ? body!.orders : [];
  return orders
    .map((o): JiniusOrderRead => {
      const lines: any[] = Array.isArray(o?.order_lines) ? o.order_lines : [];
      return {
        orderId: o?.order_id != null ? String(o.order_id) : '',
        commercialId: o?.commercial_id != null ? String(o.commercial_id) : null,
        orderedAt: o?.created_date ? new Date(o.created_date) : null,
        state: String(o?.order_state ?? '').toUpperCase() || 'UNKNOWN',
        currency: String(o?.currency_iso_code ?? 'EUR').toUpperCase(),
        taxMode: o?.order_tax_mode != null ? String(o.order_tax_mode) : null,
        priceTotal: num(o?.price),
        shippingPrice: num(o?.shipping_price),
        totalCommission: num(o?.total_commission),
        totalPrice: num(o?.total_price),
        lines: lines
          .map((l): JiniusOrderLineRead => ({
            orderLineId: l?.order_line_id != null ? String(l.order_line_id) : '',
            offerSku: typeof l?.offer_sku === 'string' ? l.offer_sku.trim() : '',
            productTitle: typeof l?.product_title === 'string' && l.product_title.trim() ? l.product_title.trim() : null,
            quantity: Math.max(0, Math.trunc(num(l?.quantity))),
            price: num(l?.price),
            unitPrice: l?.price_unit != null ? num(l.price_unit) : null,
            shippingPrice: num(l?.shipping_price),
            // total_commission where Mirakl gives it, else the fee plus its taxes.
            totalCommission: l?.total_commission != null ? num(l.total_commission) : num(l?.commission_fee) + sumAmounts(l?.commission_taxes),
            taxAmount: sumAmounts(l?.taxes),
            state: l?.order_line_state != null ? String(l.order_line_state).toUpperCase() : null,
          }))
          .filter((l) => l.orderLineId && l.offerSku),
      };
    })
    .filter((o) => o.orderId && o.orderedAt && !Number.isNaN(o.orderedAt.getTime()));
}

/**
 * How many units of a line should be off availability right now.
 *
 * Zero while the order is only promised, and zero again once it is refused or cancelled — so a
 * cancelled order gives its units back rather than holding them for ever.
 */
export function unitsToHold(line: { quantity: number; state?: string | null }, orderState: string): number {
  if (isDead(orderState) || isDead(line.state)) return 0;
  if (!holdsStock(orderState)) return 0;
  return Math.max(0, Math.trunc(line.quantity));
}
