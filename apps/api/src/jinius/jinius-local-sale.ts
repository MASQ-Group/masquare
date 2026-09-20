/**
 * Turning Jinius orders into the local sales transaction accounting issues for them.
 *
 * The money rule, decided with the business: the line's value is what Jinius sold it for LESS
 * everything Jinius keeps — the commission and the VAT on that commission — because that is the
 * money that actually arrives. That figure is VAT-inclusive, so the local invoice splits the VAT out
 * of it at the local rate rather than adding VAT on top.
 *
 * One line per order line, never merged per product: every line on the invoice traces back to one
 * order on the marketplace, which is the only way a disagreement can be settled later.
 *
 * PURE.
 */

export interface JiniusSaleLineIn {
  orderId: string;
  orderLineId: string;
  sku: string;
  title: string | null;
  productId: string | null;
  quantity: number;
  /** Line price without shipping, as Jinius reported it. */
  price: number;
  /** Commission plus its VAT — everything Jinius keeps for this line. */
  totalCommission: number;
  /**
   * The local VAT rate for this product, from its VAT class. Null when the product has none, which
   * stops the line rather than charging a rate nobody chose.
   */
  vatPct: number | null;
}

export interface LocalSaleLine {
  orderId: string;
  orderLineId: string;
  sku: string;
  title: string | null;
  productId: string | null;
  quantity: number;
  /** What the buyer's money leaves us, VAT included: price − commission. */
  grossAmount: number;
  netSalesAmount: number;
  vatAmount: number;
  vatPct: number;
}

export interface LocalSaleDraft {
  lines: LocalSaleLine[];
  grossTotal: number;
  netTotal: number;
  vatTotal: number;
  /** What Jinius kept across the batch — not part of the invoice, shown so the figures reconcile. */
  commissionTotal: number;
  /** The newest order in the batch, which is the date the invoice carries. */
  date: Date | null;
  problems: string[];
}

const round2 = (v: number) => Number(v.toFixed(2));

/**
 * The draft invoice for a batch of order lines.
 *
 * Each line splits its VAT at the product's OWN rate, the same way a local sale entered by hand
 * does — a reduced-rate product must not be invoiced at the standard rate because its money came
 * through a marketplace. A line whose value after commission is zero or less is reported as a
 * problem rather than invoiced: the fee swallowed the sale, which is a thing to look at.
 */
export function buildLocalSaleDraft(lines: JiniusSaleLineIn[], orderedAt: Map<string, Date>): LocalSaleDraft {
  const out: LocalSaleLine[] = [];
  const problems: string[] = [];
  let date: Date | null = null;

  for (const l of lines) {
    const when = orderedAt.get(l.orderId) ?? null;
    if (when && (!date || when > date)) date = when;
    if (!l.productId) {
      problems.push(`${l.sku} on order ${l.orderId} matches no product here — add the SKU to a product, then try again`);
      continue;
    }
    if (l.vatPct == null) {
      problems.push(`${l.sku} has no VAT class on its product, so its VAT cannot be worked out`);
      continue;
    }
    const gross = round2(l.price - l.totalCommission);
    if (!(gross > 0)) {
      problems.push(`${l.sku} on order ${l.orderId} is worth ${gross.toFixed(2)} after Jinius’s fee — check it before invoicing`);
      continue;
    }
    const net = round2(gross / (1 + l.vatPct / 100));
    out.push({
      orderId: l.orderId,
      orderLineId: l.orderLineId,
      sku: l.sku,
      title: l.title,
      productId: l.productId,
      quantity: l.quantity,
      grossAmount: gross,
      netSalesAmount: net,
      vatAmount: round2(gross - net),
      vatPct: l.vatPct,
    });
  }

  return {
    lines: out,
    grossTotal: round2(out.reduce((t, l) => t + l.grossAmount, 0)),
    netTotal: round2(out.reduce((t, l) => t + l.netSalesAmount, 0)),
    vatTotal: round2(out.reduce((t, l) => t + l.vatAmount, 0)),
    commissionTotal: round2(lines.reduce((t, l) => t + l.totalCommission, 0)),
    date,
    problems,
  };
}

/** The reference a created transaction carries until somebody puts the accounting invoice number on it. */
export function jiniusSaleRef(date: Date | null, orderCount: number): string {
  const d = (date ?? new Date()).toISOString().slice(0, 10);
  return `JINIUS-${d}-${orderCount}ord`;
}
