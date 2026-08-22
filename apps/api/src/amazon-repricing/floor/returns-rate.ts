// How often a SKU comes back, measured from our own sales history.
//
// The floor solver has always accepted a returns allowance and the service never supplied one, so
// every floor has been a fee-and-cost breakeven rather than a loaded one. At a 12% margin that
// omission hides inside the margin; at the low floors an aggressive strategy wants, it does not —
// a SKU returning 8% would be sold at a real loss while the engine reported it as profitable.
//
// PURE: the caller supplies the counts.

export interface ReturnsObservation {
  unitsSold: number;
  unitsReturned: number;
}

export interface ReturnsRateResult {
  /** Fraction of units returned, 0.05 = 5%. */
  rate: number;
  /** Where it came from, so a floor can state how well founded it is. */
  source: 'sku' | 'marketplace' | 'default';
  unitsSold: number;
}

/**
 * A rate is only worth using when enough units support it.
 *
 * One return out of three units sold is not a 33% return rate, it is noise — and treating it as
 * one would push that SKU's floor up by a third and take it out of contention. Below the threshold
 * the broader observation is used instead, and the caller is told which.
 */
export const MIN_UNITS_FOR_SKU_RATE = 20;
export const MIN_UNITS_FOR_MARKETPLACE_RATE = 200;

export function resolveReturnsRate(
  sku: ReturnsObservation | null,
  marketplace: ReturnsObservation | null,
  fallbackRate: number,
): ReturnsRateResult {
  if (sku && sku.unitsSold >= MIN_UNITS_FOR_SKU_RATE) {
    return { rate: clamp(sku.unitsReturned / sku.unitsSold), source: 'sku', unitsSold: sku.unitsSold };
  }
  if (marketplace && marketplace.unitsSold >= MIN_UNITS_FOR_MARKETPLACE_RATE) {
    return { rate: clamp(marketplace.unitsReturned / marketplace.unitsSold), source: 'marketplace', unitsSold: marketplace.unitsSold };
  }
  return { rate: clamp(fallbackRate), source: 'default', unitsSold: sku?.unitsSold ?? 0 };
}

/** A rate at or above 1 would make every price unprofitable; cap it well short of that. */
function clamp(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(rate, 0.5);
}

/**
 * Which cost components a floor actually accounts for.
 *
 * A floor that silently omits storage and advertising looks identical to one that includes them,
 * and the difference only matters at the margins an aggressive strategy runs at. Reporting it is
 * what lets a 2% floor be trusted or distrusted on evidence rather than on faith.
 */
export interface FloorCompleteness {
  includes: string[];
  omits: string[];
  /** True when nothing material is missing — the floor can be trusted at a low margin. */
  loaded: boolean;
}

export function describeCompleteness(parts: {
  returnsRate: number;
  returnsSource: ReturnsRateResult['source'];
  storagePerUnitCents: number;
  adCostPerUnitCents: number;
  isFba: boolean;
  /** Whether this marketplace accounts for storage at all. */
  storageApplies: boolean;
  /** Whether this marketplace accounts for advertising at all. */
  adsApply: boolean;
}): FloorCompleteness {
  const includes: string[] = ['purchase cost', 'referral fee', 'VAT'];
  const omits: string[] = [];

  includes.push(parts.isFba ? 'FBA fulfilment fee' : 'outbound shipping');

  if (parts.returnsRate > 0) {
    includes.push(`returns (${(parts.returnsRate * 100).toFixed(1)}%, ${parts.returnsSource})`);
  } else {
    omits.push('returns');
  }

  // A cost that does not apply is not missing. Storage exists only where stock sits at Amazon, so
  // it is meaningless on an FBM listing; advertising only where we actually advertise. Counting
  // either as an omission blocks a low-margin strategy on a SKU whose floor is already complete —
  // a guard that fires on cost we will never incur protects nothing and just gets worked around.
  const storageRelevant = parts.storageApplies && parts.isFba;
  if (storageRelevant) {
    if (parts.storagePerUnitCents > 0) includes.push('storage');
    else omits.push('storage');
  }
  if (parts.adsApply) {
    if (parts.adCostPerUnitCents > 0) includes.push('advertising');
    else omits.push('advertising');
  }

  return { includes, omits, loaded: omits.length === 0 };
}
