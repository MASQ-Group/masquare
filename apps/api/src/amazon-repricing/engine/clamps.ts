// Step 3 — constraint clamps (spec §5.5). Applied to the raw target in a STRICT, fixed order;
// the order is a correctness property (tested). Each clamp logs whether it bound. If clamps
// genuinely conflict (a floor above a ceiling), we DO NOT price — the SKU is quarantined for a
// human (§5.5). PURE.

export interface ClampBounds {
  /** Strategy floor — breakeven + minimum margin. Required (the whole point of the engine). */
  strategyFloorCents: number;
  /** Absolute never-cross line — used only for conflict detection here; enforced in the safety layer. */
  breakevenCents: number;
  maxPriceCents?: number | null;
  fairPricingCeilingCents?: number | null;
  amazonMinAllowedCents?: number | null;
  amazonMaxAllowedCents?: number | null;
}

export interface ClampStep {
  clamp: 'STRATEGY_FLOOR' | 'BUSINESS_MAX' | 'FAIR_PRICING_CEILING' | 'AMAZON_MIN_MAX';
  bound: boolean;
  before: number;
  after: number;
}

export type ClampResult =
  | { ok: true; priceCents: number; steps: ClampStep[] }
  | { ok: false; conflict: string; steps: ClampStep[] };

export function applyClamps(rawTargetCents: number, b: ClampBounds): ClampResult {
  // Conflict detection first — if the mandatory floor exceeds any binding ceiling, no price can
  // satisfy both. Quarantine rather than pick a side (§5.5).
  const ceilings: Array<[string, number | null | undefined]> = [
    ['maxPrice', b.maxPriceCents],
    ['fairPricingCeiling', b.fairPricingCeilingCents],
    ['amazonMaxAllowed', b.amazonMaxAllowedCents],
  ];
  for (const [name, ceil] of ceilings) {
    if (ceil != null && b.strategyFloorCents > ceil) {
      return { ok: false, conflict: `strategyFloor ${b.strategyFloorCents} > ${name} ${ceil}`, steps: [] };
    }
  }

  const steps: ClampStep[] = [];
  let price = rawTargetCents;

  const step = (clamp: ClampStep['clamp'], next: number) => {
    steps.push({ clamp, bound: next !== price, before: price, after: next });
    price = next;
  };

  // 1. Strategy floor.
  step('STRATEGY_FLOOR', Math.max(price, b.strategyFloorCents));
  // 3. Business max.
  if (b.maxPriceCents != null) step('BUSINESS_MAX', Math.min(price, b.maxPriceCents));
  // 4. Fair-pricing ceiling (§6.2).
  if (b.fairPricingCeilingCents != null) step('FAIR_PRICING_CEILING', Math.min(price, b.fairPricingCeilingCents));
  // 5. Amazon min/max backstop — clamp into the allowed band.
  if (b.amazonMinAllowedCents != null || b.amazonMaxAllowedCents != null) {
    let next = price;
    if (b.amazonMinAllowedCents != null) next = Math.max(next, b.amazonMinAllowedCents);
    if (b.amazonMaxAllowedCents != null) next = Math.min(next, b.amazonMaxAllowedCents);
    step('AMAZON_MIN_MAX', next);
  }

  return { ok: true, priceCents: price, steps };
}
