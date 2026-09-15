/**
 * The price range a SKU is repriced within: its floor, its ceiling, and the one exception that may
 * go below breakeven.
 *
 * THE FLOOR, most specific first:
 *
 *   1. CLEARANCE — while active, a person's clearance floor. The only thing that may sit below
 *      breakeven, and only for a stated reason, until a date or a stock level.
 *   2. MINIMUM PRICE — a person's fixed minimum for this SKU. Replaces the margin floor, but is
 *      raised to breakeven if it was set below it: a typed number must not quietly become a loss
 *      when fees or cost move.
 *   3. MARGIN FLOOR — the solver's lowest price that still earns the SKU's minimum margin after
 *      fees, VAT, fulfilment and returns. The default, because it follows cost and fees by itself.
 *
 * THE LOWEST ALLOWED PRICE is what the safety layer refuses to go under. It is breakeven — except
 * during clearance, when it is the clearance floor. That is the whole mechanism by which a loss can
 * be priced, and it switches itself off when clearance ends.
 *
 * PURE.
 */

export interface Clearance {
  floorCents: number;
  reason: string | null;
  /** Clearance stops at this moment. */
  endsAt: Date | null;
  /** Clearance stops once available units fall to this number or below. */
  untilStock: number | null;
}

export interface PriceRangeInput {
  breakevenCents: number | null;
  /** The solver's margin floor (`strategyFloorCents`). */
  marginFloorCents: number | null;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  clearance?: Clearance | null;
  /** Units in availability now, for a clearance that ends at a stock level. Null when unknown. */
  availableUnits?: number | null;
  now: Date;
}

export type FloorSource = 'clearance' | 'min_price' | 'margin';

export interface ResolvedRange {
  floorCents: number | null;
  floorSource: FloorSource;
  /** What the safety layer never goes under. */
  lowestAllowedCents: number | null;
  maxPriceCents: number | null;
  clearanceActive: boolean;
  /** Why a configured clearance is not active, so a page can say it has ended. */
  clearanceInactiveBecause: 'ended' | 'stock_reached' | 'no_end' | null;
  /** Things a person should see: a minimum raised to breakeven, a ceiling under the floor. */
  notes: string[];
}

const fmt = (c: number) => (c / 100).toFixed(2);

/** Whether a clearance is running now, and if not, why. */
export function clearanceState(
  c: Clearance | null | undefined,
  now: Date,
  availableUnits: number | null | undefined,
): { active: boolean; because: ResolvedRange['clearanceInactiveBecause'] } {
  if (!c) return { active: false, because: null };
  // Time-boxed or nothing: a clearance with no end would be a permanent licence to sell at a loss.
  if (c.endsAt == null && c.untilStock == null) return { active: false, because: 'no_end' };
  if (c.endsAt != null && now.getTime() >= c.endsAt.getTime()) return { active: false, because: 'ended' };
  // Unknown stock does not end a clearance — but neither can it start one that depends on stock.
  if (c.untilStock != null && availableUnits != null && availableUnits <= c.untilStock) {
    return { active: false, because: 'stock_reached' };
  }
  return { active: true, because: null };
}

export function resolvePriceRange(input: PriceRangeInput): ResolvedRange {
  const notes: string[] = [];
  const breakeven = input.breakevenCents ?? null;
  const max = input.maxPriceCents ?? null;
  const cs = clearanceState(input.clearance, input.now, input.availableUnits);

  let floor: number | null;
  let source: FloorSource;
  let lowest = breakeven;

  if (cs.active && input.clearance) {
    floor = input.clearance.floorCents;
    source = 'clearance';
    lowest = breakeven == null ? floor : Math.min(floor, breakeven);
    if (breakeven != null && floor < breakeven) {
      notes.push(`Clearance: selling down to ${fmt(floor)}, ${fmt(breakeven - floor)} below breakeven per unit.`);
    }
  } else if (input.minPriceCents != null) {
    source = 'min_price';
    if (breakeven != null && input.minPriceCents < breakeven) {
      floor = breakeven;
      notes.push(`Minimum price ${fmt(input.minPriceCents)} is below breakeven ${fmt(breakeven)}; breakeven is used. Only clearance may go lower.`);
    } else {
      floor = input.minPriceCents;
    }
  } else {
    floor = input.marginFloorCents ?? null;
    source = 'margin';
  }

  if (max != null && floor != null && max < floor) {
    notes.push(`Maximum price ${fmt(max)} is below the floor ${fmt(floor)}; the SKU cannot be priced until one of them changes.`);
  }

  return {
    floorCents: floor,
    floorSource: source,
    lowestAllowedCents: lowest,
    maxPriceCents: max,
    clearanceActive: cs.active,
    clearanceInactiveBecause: cs.because,
    notes,
  };
}

/** Problems with a clearance a person is about to save; empty when it may be saved. */
export function validateClearance(c: Clearance, now: Date): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(c.floorCents) || c.floorCents <= 0) problems.push('the clearance floor must be a price above zero');
  if (!c.reason?.trim()) problems.push('say why this SKU is being cleared');
  if (c.endsAt == null && c.untilStock == null) problems.push('give clearance an end: a date, a stock level, or both');
  if (c.endsAt != null && c.endsAt.getTime() <= now.getTime()) problems.push('the end date must be in the future');
  if (c.untilStock != null && (!Number.isInteger(c.untilStock) || c.untilStock < 0)) problems.push('the stock level must be a whole number of units, zero or more');
  return problems;
}

/**
 * A price set in bulk, for one SKU.
 *
 * One figure rarely suits many different products, so bulk values come in two kinds: a FIXED price,
 * the same for every SKU selected, or a percentage ABOVE each SKU's own breakeven. A percentage on a
 * SKU with no breakeven yet has nothing to be a percentage of, and is skipped rather than guessed.
 */
export function bulkPriceFor(
  mode: 'fixed' | 'above_breakeven_pct',
  value: number,
  breakevenCents: number | null,
): number | null {
  if (!Number.isFinite(value)) return null;
  if (mode === 'fixed') return value > 0 ? Math.round(value * 100) : null;
  if (breakevenCents == null) return null;
  return Math.round(breakevenCents * (1 + value / 100));
}
