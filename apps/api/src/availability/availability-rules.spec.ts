import { describe, expect, it } from 'vitest';

/**
 * What may put a product into availability, and what may move its quantity.
 *
 * A product enters availability deliberately — from a vendor file or by a person. Trade never adds
 * one. `adjust` used to upsert, so an order for a product nobody had stocked created a row: the
 * sale clamped it at zero, and every later cancellation added one to nothing. Production ended up
 * with 664 such rows, 324 of them advertising 1,096 units that never existed — and availability is
 * precisely the number broadcast to the marketplaces as sellable.
 *
 * Quantity moves three ways only: a vendor file, a person, or a sale. A cancellation counts as the
 * sale reversing itself, but only before shipment. After shipment the goods left, so the deduction
 * stands. A return never moves availability at all.
 */

type Row = { quantity: number; lastSource: string } | null;

/** adjust(), as the service applies it: it will not create a row. */
function adjust(
  row: Row,
  delta: number,
  reason: 'sale' | 'cancellation' | 'vendor_import' | 'manual_adjust',
): { row: Row; applied: number | null; ledgerWritten: boolean } {
  if (!row) return { row: null, applied: null, ledgerWritten: false };
  const next = Math.max(0, row.quantity + Math.trunc(delta));
  const lastSource = reason === 'vendor_import' ? 'vendor_import' : reason === 'manual_adjust' ? 'manual' : 'sale';
  return { row: { quantity: next, lastSource }, applied: next, ledgerWritten: true };
}

describe('a product that is not in availability', () => {
  it('gains nothing from a sale', () => {
    const r = adjust(null, -1, 'sale');
    expect(r.row).toBeNull();
    expect(r.applied).toBeNull();
  });

  it('gains nothing from a cancellation', () => {
    // The case that created 664 rows: +1 against a row that did not exist.
    const r = adjust(null, +1, 'cancellation');
    expect(r.row).toBeNull();
  });

  it('writes no ledger entry either', () => {
    // A ledger line for a row that does not exist is a record of something that never happened.
    expect(adjust(null, -1, 'sale').ledgerWritten).toBe(false);
    expect(adjust(null, +1, 'cancellation').ledgerWritten).toBe(false);
  });

  it('is left alone however many orders pass through it', () => {
    // Sixteen sales then fifteen cancellations — the exact shape of IT68278, which reached 17.
    let row: Row = null;
    for (let i = 0; i < 16; i++) row = adjust(row, -1, 'sale').row;
    for (let i = 0; i < 15; i++) row = adjust(row, +1, 'cancellation').row;
    expect(row).toBeNull();
  });
});

describe('a product that is in availability', () => {
  const start = (): Row => ({ quantity: 10, lastSource: 'manual' });

  it('loses the sold units on a sale', () => {
    expect(adjust(start(), -3, 'sale').row).toEqual({ quantity: 7, lastSource: 'sale' });
  });

  it('gets them back on a cancellation', () => {
    expect(adjust({ quantity: 7, lastSource: 'sale' }, +3, 'cancellation').row?.quantity).toBe(10);
  });

  it('never goes below zero', () => {
    // Selling more than we hold floors at zero rather than recording a negative stock figure.
    expect(adjust({ quantity: 2, lastSource: 'manual' }, -5, 'sale').row?.quantity).toBe(0);
  });

  it('reads as Sale after a cancellation, never as Return', () => {
    expect(adjust(start(), +1, 'cancellation').row?.lastSource).toBe('sale');
  });

  it('reads as the vendor file when a file set it', () => {
    expect(adjust(start(), +5, 'vendor_import').row?.lastSource).toBe('vendor_import');
  });
});

/**
 * Which orders touch availability at all. `shipped` comes from the channel's own word for it, so a
 * cancellation is judged on whether the goods actually left.
 */
type Tx = { resolution: 'none' | 'cancelled' | 'returned'; shipped: boolean };

const givesUnitsBack = (t: Tx) => t.resolution === 'cancelled' && !t.shipped;
const deducts = (t: Tx) => t.resolution !== 'cancelled' || t.shipped;

describe('which orders move availability', () => {
  it('gives the units back when cancelled before shipment', () => {
    expect(givesUnitsBack({ resolution: 'cancelled', shipped: false })).toBe(true);
  });

  it('keeps the deduction when cancelled after shipment', () => {
    // The goods went out. Putting them back would advertise stock that has left the building.
    const t: Tx = { resolution: 'cancelled', shipped: true };
    expect(givesUnitsBack(t)).toBe(false);
    expect(deducts(t)).toBe(true);
  });

  it('leaves a return alone entirely', () => {
    // A return is not a cancellation. The units stay deducted; putting them back is a decision
    // for a person, once someone has checked what came back and in what condition.
    const t: Tx = { resolution: 'returned', shipped: true };
    expect(givesUnitsBack(t)).toBe(false);
    expect(deducts(t)).toBe(true);
  });

  it('deducts for an ordinary order', () => {
    expect(deducts({ resolution: 'none', shipped: true })).toBe(true);
  });
});

/**
 * Nothing may be recorded against a line whose product is absent from availability — otherwise the
 * debt survives, and the day the product is added it silently starts short.
 */
describe('what the sale line records', () => {
  const reconcile = (row: Row, desired: number, alreadyDeducted: number) => {
    const move = desired - alreadyDeducted;
    if (move === 0) return { deductedQty: alreadyDeducted, touched: false };
    const applied = adjust(row, -move, move > 0 ? 'sale' : 'cancellation');
    if (applied.applied === null) return { deductedQty: alreadyDeducted, touched: false };
    return { deductedQty: desired, touched: true };
  };

  it('records nothing when the product is absent', () => {
    expect(reconcile(null, 2, 0)).toEqual({ deductedQty: 0, touched: false });
  });

  it('records the deduction when the product is present', () => {
    expect(reconcile({ quantity: 5, lastSource: 'manual' }, 2, 0)).toEqual({ deductedQty: 2, touched: true });
  });

  it('is idempotent — re-running moves nothing', () => {
    expect(reconcile({ quantity: 3, lastSource: 'sale' }, 2, 2)).toEqual({ deductedQty: 2, touched: false });
  });
});
