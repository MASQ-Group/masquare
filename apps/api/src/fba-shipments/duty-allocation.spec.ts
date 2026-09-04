import { describe, expect, it } from 'vitest';

/**
 * What an FBA shipment shares out across its SKUs.
 *
 * Carriage was the only thing an inbound-to-Amazon shipment could record, so duty was either lost
 * or folded into the shipping figure — which then stopped matching the carrier's invoice and made
 * the estimate-vs-actual comparison on carriage meaningless.
 *
 * Duty is levied on customs value, not weight, so sharing it by weight is a simplification. It is
 * the same simplification carriage already makes, and one basis per shipment keeps the per-SKU
 * figure a single number. That choice is pinned here so it is a decision rather than an accident.
 *
 * Four places allocate — the estimate, an edit, a relink, and registering the actual cost — which
 * is why the pot has exactly one definition. A duty that reached three of them would leave the same
 * shipment costing different amounts depending on which action last touched it.
 */

const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
const n = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Mirrors FbaShipmentsService.allocatablePot. */
function allocatablePot(shippingCostEur: unknown, dutyEur: unknown): number | null {
  const ship = n(shippingCostEur);
  const duty = n(dutyEur);
  if (ship == null && duty == null) return null;
  return round((ship ?? 0) + (duty ?? 0), 2);
}

type Line = { sku: string; unitWeightKg: number; quantity: number };

function allocate(lines: Line[], pot: number | null) {
  const total = lines.reduce((s, l) => s + l.unitWeightKg * l.quantity, 0);
  return lines.map((l) => ({
    sku: l.sku,
    allocated: pot == null || total <= 0 ? null : round((((l.unitWeightKg * l.quantity) / total) * pot), 4),
  }));
}

describe('the allocatable pot', () => {
  it('is carriage plus duty', () => {
    expect(allocatablePot(400, 120)).toBe(520);
  });

  it('is carriage alone when no duty was billed', () => {
    expect(allocatablePot(400, null)).toBe(400);
    expect(allocatablePot(400, undefined)).toBe(400);
    expect(allocatablePot(400, '')).toBe(400);
  });

  it('allocates duty on its own', () => {
    // The customs bill routinely lands before the carrier's. A charge already paid should not sit
    // unallocated waiting on an unrelated invoice.
    expect(allocatablePot(null, 120)).toBe(120);
  });

  it('is null only when there is genuinely nothing to share', () => {
    // null means "do not allocate", which is different from zero — a shipment with a real cost of
    // zero should still clear the lines rather than leave stale figures on them.
    expect(allocatablePot(null, null)).toBeNull();
    expect(allocatablePot(0, null)).toBe(0);
  });

  it('does not accumulate float error across the two parts', () => {
    expect(allocatablePot(10.1, 20.2)).toBe(30.3);
  });
});

describe('splitting the pot across SKUs', () => {
  const LINES: Line[] = [
    { sku: 'HEAVY', unitWeightKg: 4, quantity: 2 }, // 8 kg
    { sku: 'LIGHT', unitWeightKg: 1, quantity: 2 }, // 2 kg
  ];

  it('shares duty on the same weight basis as carriage', () => {
    const out = allocate(LINES, allocatablePot(400, 120));
    expect(out).toEqual([
      { sku: 'HEAVY', allocated: 416 }, // 80% of 520
      { sku: 'LIGHT', allocated: 104 }, // 20% of 520
    ]);
  });

  it('adds up to the pot, so nothing is lost or invented in the split', () => {
    const pot = allocatablePot(333.33, 66.67)!;
    const total = allocate(LINES, pot).reduce((s, l) => s + (l.allocated ?? 0), 0);
    expect(round(total)).toBe(pot);
  });

  it('clears the lines when there is nothing to allocate', () => {
    expect(allocate(LINES, allocatablePot(null, null))).toEqual([
      { sku: 'HEAVY', allocated: null },
      { sku: 'LIGHT', allocated: null },
    ]);
  });

  it('does not divide by zero when every line is weightless', () => {
    const weightless: Line[] = [{ sku: 'NO-WEIGHT', unitWeightKg: 0, quantity: 3 }];
    expect(allocate(weightless, 500)).toEqual([{ sku: 'NO-WEIGHT', allocated: null }]);
  });
});

describe('registering an actual cost', () => {
  // setActualCost takes duty as optional. Undefined must mean "leave what is stored", because
  // carriage and customs are billed separately and entering one must not wipe the other.
  const resolveDuty = (incoming: number | null | undefined, stored: number | null) =>
    incoming === undefined ? stored : incoming;

  it('keeps a duty already on file when only the carriage is entered', () => {
    expect(resolveDuty(undefined, 120)).toBe(120);
    expect(allocatablePot(400, resolveDuty(undefined, 120))).toBe(520);
  });

  it('clears the duty when null is sent deliberately', () => {
    expect(resolveDuty(null, 120)).toBeNull();
    expect(allocatablePot(400, resolveDuty(null, 120))).toBe(400);
  });

  it('replaces it when a new figure arrives', () => {
    expect(allocatablePot(400, resolveDuty(75, 120))).toBe(475);
  });
});
