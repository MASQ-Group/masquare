/**
 * When an availability figure stops being trustworthy, and what makes it trustworthy again.
 *
 * An order that sells more than availability holds proves the figure wrong. It does not prove the
 * product is gone: it proves we were selling units maSquare never had recorded. Clamping at zero
 * and pushing that zero to every channel — which is what happened — took down listings that still
 * had real stock, 163 of them in three weeks, and every later order for the same product did it
 * again.
 *
 * So such a sale marks the figure IN DOUBT. A figure in doubt is treated like no figure at all: no
 * push sends it, in either direction, until a person or the supplier file says what is really
 * there. That is the same rule already applied to a product with no availability row, for the same
 * reason — a number nobody can vouch for must not decide what a marketplace offers.
 *
 * PURE.
 */

export type AvailabilityReason =
  | 'sale' | 'order_cancelled' | 'order_not_submitted' | 'released' | 'quantity_reduced'
  | 'cancellation' | 'vendor_import' | 'manual_adjust';

/**
 * Did this movement sell more than we held?
 *
 * Only a sale can. A reduction for any other reason is a person or a file lowering a figure on
 * purpose, and going below zero there is a typo to clamp, not evidence about the stock.
 */
export function saleExceedsHeld(reason: AvailabilityReason, held: number, delta: number): boolean {
  return reason === 'sale' && Math.trunc(delta) < 0 && held + Math.trunc(delta) < 0;
}

/**
 * Movements that establish what is really there, and so settle a doubt.
 *
 * A supplier file and a person's adjustment are both somebody saying what exists. Releases and
 * cancellations are not: they undo trade, and undoing trade on a figure already wrong leaves it
 * just as wrong.
 */
export function settlesDoubt(reason: AvailabilityReason): boolean {
  return reason === 'vendor_import' || reason === 'manual_adjust';
}

/** What the worklist says, in words a person can act on without opening the ledger. */
export function doubtNote(held: number, delta: number, ref?: string | null): string {
  const sold = Math.abs(Math.trunc(delta));
  return `An order${ref ? ` (${ref})` : ''} sold ${sold} when maSquare held ${held}. `
    + 'Set the real figure to resume pushes to the channels.';
}
