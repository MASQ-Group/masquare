import { describe, expect, it } from 'vitest';
import { planChannelTaxRepair } from './channel-tax-repair-plan';

const line = (id: string, vat: number | null, reported: number | null, shipVat = 0) => ({
  id, vatAmount: vat, shippingAmountVat: shipVat, salesTaxAmount: reported,
});

describe('planChannelTaxRepair', () => {
  it('leaves alone the tax that is genuinely ours', () => {
    /** Japan's consumption tax is the seller's, and Amazon pays it out tax-inclusive. */
    expect(planChannelTaxRepair({
      taxType: 'jct', vatCollectedByChannel: true, items: [line('a', 1200, 1200)],
    })).toEqual({ action: 'skip' });

    /** A UK sale the marketplace did not collect on. */
    expect(planChannelTaxRepair({
      taxType: 'vat', vatCollectedByChannel: false, items: [line('a', 4.2, 4.2)],
    })).toEqual({ action: 'skip' });
  });

  it('has nothing to do when no line carries tax', () => {
    expect(planChannelTaxRepair({
      taxType: 'gst', vatCollectedByChannel: true, items: [line('a', 0, 0), line('b', null, null)],
    })).toEqual({ action: 'skip' });
  });

  it('zeroes the lines whose figure survives in salesTaxAmount', () => {
    const plan = planChannelTaxRepair({
      taxType: 'vat', vatCollectedByChannel: true, items: [line('a', 3, 3), line('b', 2, 2, 1)],
    });
    expect(plan).toEqual({ action: 'repair', amount: 6, zero: ['a', 'b'], move: [] });
  });

  /**
   * The guard that gives the repair its licence to run at all. Emptying a line whose figure exists
   * nowhere else destroys the only copy, so where the destination really does have a VAT — and the
   * money might therefore be ours — nobody gets to decide but a person.
   */
  it('refuses an order whose VAT has no reported total behind it', () => {
    expect(planChannelTaxRepair({
      taxType: 'vat', vatCollectedByChannel: true, items: [line('a', 8.26, 0)],
    })).toEqual({ action: 'refuse' });

    expect(planChannelTaxRepair({
      taxType: 'vat', vatCollectedByChannel: true, items: [line('a', 3, 3), line('b', 5, null)],
    })).toEqual({ action: 'refuse' });
  });

  /**
   * 114-3886483-9295419 — an Amazon US order carrying 4.13 of `vatAmount` on each of two lines with
   * nothing in `salesTaxAmount`. The United States has no VAT, so the figure is not disputed, it is
   * misfiled: refusing it left an order reconciling against nothing, and zeroing it would have
   * destroyed the 8.26 outright.
   */
  it('moves the figure instead, where the destination has no VAT to dispute', () => {
    const plan = planChannelTaxRepair({
      taxType: 'sales_tax', vatCollectedByChannel: true, items: [line('a', 4.13, 0), line('b', 4.13, null)],
    });
    expect(plan).toEqual({
      action: 'repair',
      amount: 8.26,
      zero: [],
      move: [{ id: 'a', salesTaxAmount: 4.13 }, { id: 'b', salesTaxAmount: 4.13 }],
    });
  });

  it('moves GST the same way, and carries shipping tax with it', () => {
    expect(planChannelTaxRepair({
      taxType: 'gst', vatCollectedByChannel: false, items: [line('a', 12, 0, 2.54)],
    })).toEqual({
      action: 'repair', amount: 14.54, zero: [], move: [{ id: 'a', salesTaxAmount: 14.54 }],
    });
  });

  /**
   * A line that already has the channel's own figure must not have one written over the top of it,
   * even when a sibling line on the same order needs moving. Hence line by line, not order by order.
   */
  it('handles both kinds on one order without overwriting the channel’s own figure', () => {
    const plan = planChannelTaxRepair({
      taxType: 'sales_tax',
      vatCollectedByChannel: true,
      items: [line('keeps-its-total', 5, 5), line('has-none', 3, 0)],
    });
    expect(plan).toEqual({
      action: 'repair', amount: 8, zero: ['keeps-its-total'], move: [{ id: 'has-none', salesTaxAmount: 3 }],
    });
  });

  /**
   * The move only ever relocates. Whatever leaves `vatAmount` arrives in `salesTaxAmount` to the
   * cent — if these two ever disagree, money has been invented or lost rather than filed correctly.
   */
  it('never changes the amount, only which column holds it', () => {
    const cases = [
      [line('a', 4.13, 0), line('b', 4.13, null)],
      [line('a', 0.01, 0)],
      [line('a', 99.99, 0, 0.01)],
      [line('a', 12, 0), line('b', 7, 7), line('c', 0.5, null)],
    ];
    for (const items of cases) {
      const plan = planChannelTaxRepair({ taxType: 'sales_tax', vatCollectedByChannel: true, items });
      if (plan.action !== 'repair') throw new Error('expected a repair');
      const leaving = items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
      const arriving = plan.move.reduce((s, mv) => s + mv.salesTaxAmount, 0);
      const dropped = items
        .filter((i) => plan.zero.includes(i.id))
        .reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
      expect(plan.amount).toBeCloseTo(leaving, 10);
      expect(arriving + dropped).toBeCloseTo(leaving, 10);
    }
  });

  /** A negative figure is a refund's tax, and it relocates like any other rather than being dropped. */
  it('moves a negative figure rather than treating it as nothing', () => {
    expect(planChannelTaxRepair({
      taxType: 'sales_tax', vatCollectedByChannel: true, items: [line('a', -4.13, 0)],
    })).toEqual({ action: 'repair', amount: -4.13, zero: [], move: [{ id: 'a', salesTaxAmount: -4.13 }] });
  });
});
