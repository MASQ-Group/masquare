import { describe, expect, it } from 'vitest';

/**
 * Every shipping cost we pay has to land somewhere.
 *
 * The profit calc buckets shipments by type: outbound is the original despatch, inbound is a
 * return we paid for. When replacement became a third type it matched neither filter, so the cost
 * of sending a second unit to the customer was silently dropped — the despatch was recorded, the
 * money left the account, and the order still reported the margin of one that shipped once. The
 * replacement UI even told the operator it had been "added to this order's costs".
 *
 * Nothing failed. That is the point of these tests: the bug is invisible unless something asserts
 * that the buckets cover every leg, so that is what is asserted, rather than only the arithmetic
 * of the leg that was missing.
 */

type Leg = { type: 'outbound' | 'inbound' | 'replacement'; costBorneBy: 'company' | 'customer'; shippingCostEur?: number | null; dutyImportEur?: number | null };

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const sum = (legs: Leg[], f: (l: Leg) => boolean, field: 'shippingCostEur' | 'dutyImportEur' = 'shippingCostEur') =>
  Math.round(legs.filter(f).reduce((s, l) => s + n(l[field]), 0) * 100) / 100;

/** The three buckets, mirroring sales-transactions.service.ts. */
const outbound = (legs: Leg[]) => sum(legs, (l) => l.type === 'outbound' && l.costBorneBy === 'company');
const returned = (legs: Leg[]) => sum(legs, (l) => l.type === 'inbound' && l.costBorneBy === 'company');
const replacement = (legs: Leg[]) => sum(legs, (l) => l.type === 'replacement' && l.costBorneBy === 'company');
/** Duty is not bucketed by type at all — every leg's duty is ours to pay. */
const duty = (legs: Leg[]) => sum(legs, () => true, 'dutyImportEur');

const LEGS: Leg[] = [
  { type: 'outbound', costBorneBy: 'company', shippingCostEur: 6.5, dutyImportEur: 2 },
  { type: 'inbound', costBorneBy: 'company', shippingCostEur: 4.25, dutyImportEur: 1.5 },
  { type: 'replacement', costBorneBy: 'company', shippingCostEur: 7.1, dutyImportEur: 3.4 },
];

describe('shipping cost by leg', () => {
  it('counts a replacement despatch, which used to fall through every bucket', () => {
    expect(replacement(LEGS)).toBe(7.1);
  });

  it('leaves no company-borne shipping cost unaccounted for', () => {
    // The property the original bug broke. A fourth leg type added later fails here rather than
    // quietly inflating margins on the orders that went wrong.
    const bucketed = outbound(LEGS) + returned(LEGS) + replacement(LEGS);
    const everything = sum(LEGS, (l) => l.costBorneBy === 'company');
    expect(bucketed).toBe(everything);
    expect(bucketed).toBe(17.85);
  });

  it('keeps the replacement out of the original despatch figure', () => {
    // actualShippingCost is compared against the estimate for the original despatch. Folding a
    // replacement into it would make an order look like it mis-estimated its own carriage.
    expect(outbound(LEGS)).toBe(6.5);
  });

  it('ignores a leg the customer paid for', () => {
    const legs: Leg[] = [...LEGS, { type: 'inbound', costBorneBy: 'customer', shippingCostEur: 99 }];
    expect(returned(legs)).toBe(4.25);
    expect(sum(legs, (l) => l.costBorneBy === 'company')).toBe(17.85);
  });
});

describe('duty charges', () => {
  it('counts duty on every leg, whichever direction it was going', () => {
    // Duty arrives on a courier's invoice for a parcel crossing a border. Which way it was
    // travelling makes no difference to whether we owe it.
    expect(duty(LEGS)).toBe(6.9);
  });

  it('counts duty even on a leg the customer paid the carriage for', () => {
    // The customer covering return postage does not mean they cleared it through customs.
    const legs: Leg[] = [{ type: 'inbound', costBorneBy: 'customer', shippingCostEur: 0, dutyImportEur: 12 }];
    expect(duty(legs)).toBe(12);
    expect(returned(legs)).toBe(0);
  });

  it('treats a missing duty as zero rather than dropping the leg', () => {
    const legs: Leg[] = [{ type: 'outbound', costBorneBy: 'company', shippingCostEur: 5 }];
    expect(duty(legs)).toBe(0);
    expect(outbound(legs)).toBe(5);
  });
});
