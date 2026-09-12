import { marketplaceRemitsTax, regimeHasNoVat } from '../integrations/mappings/tax-collection';

/**
 * What the channel-collected tax repair should do with one order — decided, not done.
 *
 * The repair reads thousands of orders and writes to a handful, and for a long time the only way to
 * find out which was to run it. The three-way decision below is the whole of its judgement, so it
 * lives here as a pure function: given an order, say what should happen to it and why.
 *
 * Splitting it out is not tidiness. The rule grew a third branch — move, alongside zero and refuse —
 * after a single Amazon US order turned up holding VAT in a country that has none, and a branch that
 * rewrites money is worth being able to test without a database.
 */

export type RepairLine = {
  id: string;
  vatAmount?: number | null;
  shippingAmountVat?: number | null;
  salesTaxAmount?: number | null;
};

export type RepairPlan =
  /** Not the marketplace's tax, or no tax on it at all. Nothing to do and nothing to report. */
  | { action: 'skip' }
  /**
   * The tax is the marketplace's, but a line holds the only copy of the figure and the destination
   * really does have a VAT — so the amount might be ours. Refusing says so; a person decides.
   */
  | { action: 'refuse' }
  /** Zero the lines whose figure survives in `salesTaxAmount`, move the ones where it does not. */
  | {
      action: 'repair';
      /** Native currency. What leaves `vatAmount`, whether it is dropped or relocated. */
      amount: number;
      zero: string[];
      move: { id: string; salesTaxAmount: number }[];
    };

export function planChannelTaxRepair(order: {
  taxType?: string | null;
  vatCollectedByChannel?: boolean | null;
  items: readonly RepairLine[];
}): RepairPlan {
  if (!marketplaceRemitsTax({ taxType: order.taxType, vatCollectedByChannel: order.vatCollectedByChannel })) {
    return { action: 'skip' };
  }

  const carrying = order.items.filter((i) => (i.vatAmount ?? 0) !== 0 || (i.shippingAmountVat ?? 0) !== 0);
  if (carrying.length === 0) return { action: 'skip' };

  /**
   * A line with tax but no `salesTaxAmount` behind it holds the figure in one place only. Zeroing it
   * would end that, so what may be done next turns on the DESTINATION rather than the amount: where
   * no VAT exists the figure cannot be VAT, and moving it asserts nothing that was not already true.
   */
  const unreported = carrying.filter((i) => (i.salesTaxAmount ?? 0) === 0);
  if (unreported.length && !regimeHasNoVat(order.taxType)) return { action: 'refuse' };

  const zero: string[] = [];
  const move: { id: string; salesTaxAmount: number }[] = [];
  let amount = 0;

  /**
   * Line by line, because one order may hold both kinds. A line that DOES have a reported total must
   * still be zeroed rather than have a figure written over the top of the channel's own.
   */
  for (const i of carrying) {
    const line = (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0);
    amount += line;
    if ((i.salesTaxAmount ?? 0) === 0) move.push({ id: i.id, salesTaxAmount: line });
    else zero.push(i.id);
  }

  return { action: 'repair', amount, zero, move };
}
