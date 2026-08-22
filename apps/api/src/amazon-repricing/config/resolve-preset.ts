import { REPRICING_DEFAULTS } from './repricing.config';

// Where a SKU's repricing parameters come from.
//
// Three layers, most specific first: a per-SKU override, then the named preset it follows, then
// the global default. The per-SKU columns predate presets and are how an exception is expressed —
// a preset that overrode them would silently discard a deliberate decision about one listing.

export interface PresetValues {
  strategy: string;
  minMarginPct: unknown;
  probeStepPct: unknown;
  probeIntervalMinutes: number | null;
  fbmPremiumPct: unknown;
  epsilonCents: number | null;
  requiresLoadedFloor: boolean;
  name: string;
}

export interface SkuOverrides {
  strategy?: string | null;
  minMarginPct?: unknown;
  probeStepPct?: unknown;
  probeIntervalMinutes?: number | null;
  fbmPremiumPct?: unknown;
  epsilonCents?: number | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface ResolvedParams {
  /** Minimum net margin as a FRACTION (0.12 = 12%), which is what the solver takes. */
  minMarginPct: number;
  /** Same value as a percentage, for display and storage. */
  minMarginPctDisplay: number;
  strategy: string;
  probeStepPct: number | null;
  probeIntervalMinutes: number | null;
  fbmPremiumPct: number | null;
  epsilonCents: number | null;
  /** Which layer supplied the margin, so a surprising floor can be traced. */
  marginFrom: 'sku' | 'preset' | 'default';
  presetName: string | null;
  requiresLoadedFloor: boolean;
}

export function resolveParams(sku: SkuOverrides, preset: PresetValues | null | undefined): ResolvedParams {
  const skuMargin = num(sku.minMarginPct);
  const presetMargin = preset ? num(preset.minMarginPct) : null;

  const marginPct =
    skuMargin != null ? skuMargin : presetMargin != null ? presetMargin : REPRICING_DEFAULTS.minMarginPct * 100;
  const marginFrom: ResolvedParams['marginFrom'] =
    skuMargin != null ? 'sku' : presetMargin != null ? 'preset' : 'default';

  const pick = <T>(a: T | null | undefined, b: T | null | undefined): T | null => (a != null ? a : b != null ? b : null);

  return {
    minMarginPct: marginPct / 100,
    minMarginPctDisplay: marginPct,
    // MANUAL_ONLY on a SKU is a deliberate "leave this alone", so it is never overridden by a preset.
    strategy: sku.strategy ?? preset?.strategy ?? 'BUY_BOX',
    probeStepPct: pick(num(sku.probeStepPct), preset ? num(preset.probeStepPct) : null),
    probeIntervalMinutes: pick(sku.probeIntervalMinutes ?? null, preset?.probeIntervalMinutes ?? null),
    fbmPremiumPct: pick(num(sku.fbmPremiumPct), preset ? num(preset.fbmPremiumPct) : null),
    epsilonCents: pick(sku.epsilonCents ?? null, preset?.epsilonCents ?? null),
    marginFrom,
    presetName: preset?.name ?? null,
    requiresLoadedFloor: preset?.requiresLoadedFloor ?? false,
  };
}

/**
 * Whether a preset may be applied to a SKU.
 *
 * An aggressive preset on a floor that omits storage or advertising is not merely optimistic: at
 * 2% those omissions exceed the margin, so the SKU sells at a real loss while the engine reports a
 * profit. Refused rather than warned about, because a warning on a bulk apply is read once and the
 * mispricing lasts until someone notices the margin.
 */
export function canApplyPreset(
  preset: { requiresLoadedFloor: boolean; name: string },
  sku: { floorOmits?: string[] | null; strategyFloorCents?: number | null },
): { ok: true } | { ok: false; reason: string } {
  if (!preset.requiresLoadedFloor) return { ok: true };
  const omits = sku.floorOmits ?? [];
  if (omits.length === 0) return { ok: true };
  return {
    ok: false,
    reason: `${preset.name} needs a fully loaded floor; this one omits ${omits.join(', ')}`,
  };
}
