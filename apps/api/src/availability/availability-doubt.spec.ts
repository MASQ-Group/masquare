import { describe, expect, it } from 'vitest';
import { doubtNote, saleExceedsHeld, settlesDoubt } from './availability-doubt';

describe('saleExceedsHeld', () => {
  /** The incident: an Amazon order for ATH-NES-CLAS-200G-PO2 arrived while availability said 0. */
  it('is true for a sale arriving when we hold nothing', () => {
    expect(saleExceedsHeld('sale', 0, -2)).toBe(true);
  });

  it('is true for a sale of more than we hold', () => {
    expect(saleExceedsHeld('sale', 1, -3)).toBe(true);
  });

  /** Selling out exactly is the system working: the listing is right to close. */
  it('is false for a sale that takes us exactly to zero', () => {
    expect(saleExceedsHeld('sale', 3, -3)).toBe(false);
    expect(saleExceedsHeld('sale', 5, -1)).toBe(false);
  });

  it('is false for anything that is not a sale, however far below zero it would go', () => {
    expect(saleExceedsHeld('manual_adjust', 0, -4)).toBe(false);
    expect(saleExceedsHeld('vendor_import', 1, -9)).toBe(false);
    expect(saleExceedsHeld('quantity_reduced', 0, -1)).toBe(false);
  });

  it('is false for movements that add stock', () => {
    expect(saleExceedsHeld('sale', 0, 2)).toBe(false);
    expect(saleExceedsHeld('released', 0, 2)).toBe(false);
  });
});

describe('settlesDoubt', () => {
  it('settles on a supplier file or a person saying what is there', () => {
    expect(settlesDoubt('vendor_import')).toBe(true);
    expect(settlesDoubt('manual_adjust')).toBe(true);
  });

  /** Undoing trade on a figure already wrong leaves it wrong. */
  it('does not settle on releases, cancellations or further sales', () => {
    expect(settlesDoubt('released')).toBe(false);
    expect(settlesDoubt('order_cancelled')).toBe(false);
    expect(settlesDoubt('sale')).toBe(false);
  });
});

describe('doubtNote', () => {
  it('says what happened and what to do', () => {
    expect(doubtNote(0, -2, '202-4435476-3609907'))
      .toBe('An order (202-4435476-3609907) sold 2 when maSquare held 0. Set the real figure to resume pushes to the channels.');
  });
});
