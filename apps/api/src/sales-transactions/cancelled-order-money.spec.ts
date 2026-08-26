import { describe, expect, it } from 'vitest';

/**
 * What a cancelled order is worth.
 *
 * An order the customer cancelled before dispatch was reporting a profit — and not merely a
 * leftover one. The old rule reversed the cost of goods (correct: they never left) while KEEPING
 * the revenue (wrong: the money is going back), so a cancelled order looked MORE profitable than a
 * fulfilled one. The bigger the order, the better it looked.
 *
 * A refund would have corrected it, and we do pull refunds — but only from the Finances API's
 * RefundEventList, which books adjustments against a SHIPMENT. An order cancelled before dispatch
 * has no shipment and usually never had payment captured at all, so no refund event ever arrives.
 * Waiting for one means waiting forever.
 *
 * So the order is worth nothing: no revenue, no cost, no fee, no profit.
 *
 * And "did it ship" is answered by the CHANNEL, not by us. Our own record says whether we logged a
 * shipment, which is a different question — an order nobody has got round to recording looks
 * identical to one Amazon cancelled, and only Amazon can tell them apart.
 */

type Tx = {
  resolution: string;
  /** From Amazon's OrderStatus. Null for a manual sale, which has no channel to ask. */
  channelShipmentStatus: 'shipped' | 'not_shipped' | null;
  /** Whether WE recorded an outbound shipment. */
  hasOutbound: boolean;
};

const cancelledPreShip = (t: Tx): boolean => {
  const channelShipped = t.channelShipmentStatus != null ? t.channelShipmentStatus === 'shipped' : t.hasOutbound;
  return t.resolution === 'cancelled' && !channelShipped;
};

describe('deciding whether the goods went', () => {
  it('believes the channel over our own paperwork', () => {
    // Amazon says it never shipped. That we have not recorded a shipment either is beside the point
    // — the channel is the one that knows.
    expect(cancelledPreShip({ resolution: 'cancelled', channelShipmentStatus: 'not_shipped', hasOutbound: false })).toBe(true);
  });

  it('does not treat a shipped order as pre-dispatch just because we never logged it', () => {
    // The case the old rule got wrong in the other direction: Amazon shipped it, our record is
    // simply behind, and zeroing the money would erase a real sale.
    expect(cancelledPreShip({ resolution: 'cancelled', channelShipmentStatus: 'shipped', hasOutbound: false })).toBe(false);
  });

  it('falls back to our own record for a manual sale', () => {
    // No channel means no channel opinion, and our shipment record is then the only word there is.
    expect(cancelledPreShip({ resolution: 'cancelled', channelShipmentStatus: null, hasOutbound: false })).toBe(true);
    expect(cancelledPreShip({ resolution: 'cancelled', channelShipmentStatus: null, hasOutbound: true })).toBe(false);
  });

  it('says nothing about an order that was not cancelled', () => {
    expect(cancelledPreShip({ resolution: 'none', channelShipmentStatus: 'not_shipped', hasOutbound: false })).toBe(false);
    expect(cancelledPreShip({ resolution: 'returned', channelShipmentStatus: 'shipped', hasOutbound: true })).toBe(false);
  });
});

describe('what it is worth', () => {
  // The figures a transaction reports, before and after the rule.
  const gross = { revenueExVatEur: 184.5, feesEur: 27.7, cogsEur: 92, profitEur: 64.8 };

  const settle = (t: Tx) =>
    cancelledPreShip(t)
      ? { revenueExVatEur: 0, feesEur: 0, cogsEur: 0, profitEur: 0 }
      : gross;

  it('is worth nothing when it never shipped', () => {
    expect(settle({ resolution: 'cancelled', channelShipmentStatus: 'not_shipped', hasOutbound: false }))
      .toEqual({ revenueExVatEur: 0, feesEur: 0, cogsEur: 0, profitEur: 0 });
  });

  it('never reports profit on a cancellation', () => {
    // The old behaviour: revenue kept, COGS reversed, so profit came out HIGHER than the real sale.
    const old = { ...gross, cogsEur: 0, profitEur: gross.profitEur + 92 };
    expect(old.profitEur).toBeGreaterThan(gross.profitEur); // this is what was happening
    expect(settle({ resolution: 'cancelled', channelShipmentStatus: 'not_shipped', hasOutbound: false }).profitEur).toBe(0);
  });

  it('zeroes revenue as well as profit, so the two cannot disagree', () => {
    // Analytics reads revenueExVatEur rather than recomputing. Zeroing only the profit would keep
    // the sale in every revenue total while the order itself claimed to have earned nothing.
    const s = settle({ resolution: 'cancelled', channelShipmentStatus: 'not_shipped', hasOutbound: false });
    expect(s.revenueExVatEur).toBe(0);
    expect(s.feesEur).toBe(0);
  });

  it('leaves a genuine sale alone', () => {
    expect(settle({ resolution: 'none', channelShipmentStatus: 'shipped', hasOutbound: true })).toEqual(gross);
  });

  it('leaves a shipped-then-cancelled order to the refund path', () => {
    // Those DO get a Finances refund event, because there was a shipment to book it against.
    expect(settle({ resolution: 'cancelled', channelShipmentStatus: 'shipped', hasOutbound: true })).toEqual(gross);
  });
});

describe('every figure a reader calls revenue', () => {
  // The list column reads the NATIVE totals, not the EUR ones. Zeroing the profit and the EUR
  // revenue while leaving these intact showed an order earning nothing and selling 184.24 on the
  // same row — which is how this was spotted on order 702-2579052-5535426.
  const totals = { netSales: 184.24, vat: 35.01, shipping: 4.99, shippingVat: 0.95 };
  const settle = (cancelled: boolean) => (cancelled ? { ...totals, netSales: 0, vat: 0, shipping: 0, shippingVat: 0 } : totals);

  it('zeroes the native totals, not just the EUR ones', () => {
    expect(settle(true)).toEqual({ netSales: 0, vat: 0, shipping: 0, shippingVat: 0 });
  });

  it('makes the transaction total agree', () => {
    const t = settle(true);
    expect(t.netSales + t.vat + t.shipping + t.shippingVat).toBe(0);
  });

  it('leaves a real sale untouched', () => {
    expect(settle(false)).toEqual(totals);
  });
});
