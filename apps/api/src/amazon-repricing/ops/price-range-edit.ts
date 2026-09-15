import { bulkPriceFor, resolvePriceRange, validateClearance, type ResolvedRange } from '../floor/price-range';

/**
 * One change to a SKU's price range — from the row editor, a bulk edit or a spreadsheet import —
 * planned before anything is written.
 *
 * All three routes go through here so they cannot apply different rules: a minimum price typed on
 * one row, set for a whole brand, or read from a spreadsheet is checked the same way and previewed
 * the same way. A row with any problem is not changed at all, rather than changed in part.
 *
 * PURE.
 */

/** A price to set: a fixed amount, a percentage above the SKU's own breakeven, or cleared. */
export type PriceSetting =
  | { mode: 'fixed'; value: number }
  | { mode: 'above_breakeven_pct'; value: number }
  | { mode: 'clear' };

export interface RangeChange {
  minPrice?: PriceSetting;
  maxPrice?: PriceSetting;
  /** Minimum margin in PERCENT (12 = 12%). Null clears it back to the strategy or the default. */
  minMarginPct?: number | null;
  clearance?:
    | { mode: 'set'; floor: PriceSetting; reason: string; endsAt: string | null; untilStock: number | null }
    | { mode: 'clear' };
}

/** The columns a plan reads. Margin in percent, as stored. */
export interface RangeRow {
  breakevenCents: number | null;
  strategyFloorCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  minMarginPct: number | null;
  clearanceFloorCents: number | null;
  clearanceReason: string | null;
  clearanceEndsAt: Date | null;
  clearanceUntilStock: number | null;
}

export interface RangeData {
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  minMarginPct?: number | null;
  clearanceFloorCents?: number | null;
  clearanceReason?: string | null;
  clearanceEndsAt?: Date | null;
  clearanceUntilStock?: number | null;
  clearanceSetAt?: Date | null;
  clearanceSetById?: string | null;
}

export interface RangePlan {
  /** Columns to write. Empty when there is nothing to change or there are problems. */
  data: RangeData;
  problems: string[];
  /** The margin moved, so the solved margin floor must be recomputed after writing. */
  marginChanged: boolean;
  before: ResolvedRange;
  /** With the margin floor as it stands — a margin change shows its new floor once recomputed. */
  after: ResolvedRange;
  changed: boolean;
}

/** Highest minimum margin accepted. Anything under 0% is a loss, which only clearance may price. */
export const MAX_MARGIN_PCT = 90;

function rangeOf(r: RangeRow, now: Date, availableUnits: number | null): ResolvedRange {
  return resolvePriceRange({
    breakevenCents: r.breakevenCents,
    marginFloorCents: r.strategyFloorCents,
    minPriceCents: r.minPriceCents,
    maxPriceCents: r.maxPriceCents,
    clearance: r.clearanceFloorCents != null
      ? { floorCents: r.clearanceFloorCents, reason: r.clearanceReason, endsAt: r.clearanceEndsAt, untilStock: r.clearanceUntilStock }
      : null,
    availableUnits,
    now,
  });
}

function priceFor(setting: PriceSetting, breakevenCents: number | null, what: string, problems: string[]): number | null | undefined {
  if (setting.mode === 'clear') return null;
  const cents = bulkPriceFor(setting.mode, setting.value, breakevenCents);
  if (cents == null) {
    problems.push(setting.mode === 'above_breakeven_pct'
      ? `${what}: no breakeven has been calculated for this SKU yet, so a percentage above it cannot be set`
      : `${what}: must be a price above zero`);
    return undefined;
  }
  if (cents <= 0) { problems.push(`${what}: must be a price above zero`); return undefined; }
  return cents;
}

export function planRangeChange(
  row: RangeRow,
  change: RangeChange,
  opts: { now: Date; actorId?: string | null; availableUnits?: number | null },
): RangePlan {
  const problems: string[] = [];
  const data: RangeData = {};
  const units = opts.availableUnits ?? null;

  if (change.minPrice) {
    const v = priceFor(change.minPrice, row.breakevenCents, 'Minimum price', problems);
    if (v !== undefined) data.minPriceCents = v;
  }
  if (change.maxPrice) {
    const v = priceFor(change.maxPrice, row.breakevenCents, 'Maximum price', problems);
    if (v !== undefined) data.maxPriceCents = v;
  }
  if (change.minMarginPct !== undefined) {
    const m = change.minMarginPct;
    if (m == null) data.minMarginPct = null;
    else if (!Number.isFinite(m) || m < 0 || m > MAX_MARGIN_PCT) {
      problems.push(`Margin: must be between 0% and ${MAX_MARGIN_PCT}% — selling below breakeven is only possible in clearance`);
    } else data.minMarginPct = Math.round(m * 100) / 100;
  }
  if (change.clearance) {
    if (change.clearance.mode === 'clear') {
      Object.assign(data, {
        clearanceFloorCents: null, clearanceReason: null, clearanceEndsAt: null, clearanceUntilStock: null,
        clearanceSetAt: null, clearanceSetById: null,
      });
    } else {
      const c = change.clearance;
      const floor = c.floor.mode === 'clear' ? undefined : priceFor(c.floor, row.breakevenCents, 'Clearance floor', problems);
      if (c.floor.mode === 'clear') problems.push('Clearance floor: a clearance needs a floor price');
      const endsAt = c.endsAt ? new Date(c.endsAt) : null;
      if (endsAt && Number.isNaN(endsAt.getTime())) problems.push('Clearance end date: not a date');
      if (typeof floor === 'number') {
        const clearance = { floorCents: floor, reason: c.reason, endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null, untilStock: c.untilStock };
        const p = validateClearance(clearance, opts.now).map((x) => `Clearance: ${x}`);
        problems.push(...p);
        if (p.length === 0) {
          Object.assign(data, {
            clearanceFloorCents: clearance.floorCents,
            clearanceReason: c.reason.trim(),
            clearanceEndsAt: clearance.endsAt,
            clearanceUntilStock: clearance.untilStock,
            clearanceSetAt: opts.now,
            clearanceSetById: opts.actorId ?? null,
          });
        }
      }
    }
  }

  const next: RangeRow = { ...row, ...(data as Partial<RangeRow>) };
  if (next.minPriceCents != null && next.maxPriceCents != null && next.maxPriceCents < next.minPriceCents) {
    problems.push('Maximum price is below the minimum price');
  }

  const before = rangeOf(row, opts.now, units);
  const after = rangeOf(next, opts.now, units);
  if (problems.length) return { data: {}, problems, marginChanged: false, before, after: before, changed: false };

  const same = (k: keyof RangeData) => {
    const a = (row as any)[k];
    const b = (data as any)[k];
    return a instanceof Date || b instanceof Date ? (a?.getTime?.() ?? null) === (b?.getTime?.() ?? null) : a === b;
  };
  const keys = (Object.keys(data) as (keyof RangeData)[]).filter((k) => k !== 'clearanceSetAt' && k !== 'clearanceSetById');
  const changed = keys.some((k) => !same(k));
  return {
    data: changed ? data : {},
    problems,
    marginChanged: data.minMarginPct !== undefined && data.minMarginPct !== row.minMarginPct,
    before,
    after,
    changed,
  };
}

// ── Spreadsheet ──────────────────────────────────────────────────────────────────────────────────

/** The columns of the range spreadsheet, in order. Export and import use the same list. */
export const RANGE_SHEET_COLUMNS = [
  'SKU', 'Marketplace', 'ASIN', 'Brand', 'Vendor', 'Product type', 'Currency', 'Current price',
  'Breakeven', 'Margin floor', 'Floor in use', 'Floor from',
  'Min price', 'Max price', 'Margin %',
  'Clearance floor', 'Clearance reason', 'Clearance ends', 'Clearance until stock',
] as const;

/** The columns an import reads; the rest are there to be read by a person. */
export const EDITABLE_COLUMNS = ['Min price', 'Max price', 'Margin %', 'Clearance floor', 'Clearance reason', 'Clearance ends', 'Clearance until stock'] as const;

/** The marker that clears a value. A blank cell leaves it as it is. */
export const CLEAR_MARKER = '-';

const cell = (row: Record<string, unknown>, key: string): string => String(row[key] ?? '').trim();

/** A price as people type it: "19.99", "€19,99", "1,299.00". A lone comma is a decimal comma. */
function parseMoney(raw: string): number | null {
  let t = raw.replace(/[£€$\s]/g, '');
  t = t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t.replace(/,/g, '');
  const n = t === '' ? NaN : Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * One spreadsheet row as a change. Blank leaves a value alone; `-` clears it.
 *
 * A clearance is read as a whole: any clearance cell filled means the row sets a clearance, and all
 * four are then read together, because a floor without its reason or its end is not a clearance.
 */
export function parseRangeRow(row: Record<string, unknown>): { sku: string; marketplace: string; change: RangeChange; problems: string[] } {
  const problems: string[] = [];
  const change: RangeChange = {};
  const sku = cell(row, 'SKU');
  const marketplace = cell(row, 'Marketplace').toUpperCase();
  if (!sku) problems.push('SKU is empty');
  if (!marketplace) problems.push('Marketplace is empty');

  const price = (key: string): PriceSetting | undefined => {
    const raw = cell(row, key);
    if (!raw) return undefined;
    if (raw === CLEAR_MARKER) return { mode: 'clear' };
    const v = parseMoney(raw);
    if (v == null) { problems.push(`${key}: "${raw}" is not a price`); return undefined; }
    return { mode: 'fixed', value: v };
  };
  const min = price('Min price'); if (min) change.minPrice = min;
  const max = price('Max price'); if (max) change.maxPrice = max;

  const margin = cell(row, 'Margin %');
  if (margin === CLEAR_MARKER) change.minMarginPct = null;
  else if (margin) {
    const v = Number(margin.replace('%', ''));
    if (Number.isFinite(v)) change.minMarginPct = v; else problems.push(`Margin %: "${margin}" is not a number`);
  }

  const cFloor = cell(row, 'Clearance floor');
  const cReason = cell(row, 'Clearance reason');
  const cEnds = cell(row, 'Clearance ends');
  const cStock = cell(row, 'Clearance until stock');
  if (cFloor === CLEAR_MARKER) change.clearance = { mode: 'clear' };
  else if (cFloor || cReason || cEnds || cStock) {
    const floor = cFloor ? parseMoney(cFloor) : null;
    if (cFloor && floor == null) problems.push(`Clearance floor: "${cFloor}" is not a price`);
    let endsAt: string | null = null;
    if (cEnds) {
      // A date means clearance runs to the END of that day, which is what a person writing it means.
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cEnds);
      if (!m) problems.push(`Clearance ends: "${cEnds}" is not a date as YYYY-MM-DD`);
      else endsAt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)).toISOString();
    }
    let untilStock: number | null = null;
    if (cStock) {
      const n = Number(cStock);
      if (Number.isInteger(n) && n >= 0) untilStock = n; else problems.push(`Clearance until stock: "${cStock}" is not a whole number`);
    }
    change.clearance = {
      mode: 'set',
      floor: floor == null ? { mode: 'clear' } : { mode: 'fixed', value: floor },
      reason: cReason,
      endsAt,
      untilStock,
    };
  }
  return { sku, marketplace, change, problems };
}
