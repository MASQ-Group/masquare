import { toNumber } from './value-kind';

// Turn matched rows into a list of proposed field changes. PURE.
//
// This is the last point at which a mistake is still cheap. A bulk cost change does not announce
// itself — it moves margins, breakevens and repricing floors at once, and nothing in a P&L says
// "a file did this" — so every change is computed here, shown, and only then applied.

export type ChangeField = 'purchaseCost' | 'map' | 'availability' | 'ean' | 'upc';

export interface PlanProduct {
  id: string;
  mainSku: string;
  title: string;
  purchaseCostAmount: number | null;
  purchaseCostCurrency: string;
  mapAmount: number | null;
  mapCurrency: string;
  ean: string | null;
  upc: string | null;
  availability: number | null;
  /** Product's VAT rate as a percentage, for grossing up a MAP the vendor quotes net. */
  vatRatePct: number | null;
}

export interface PlanRowInput {
  productId: string;
  /** Raw cell values as they appear in the file. */
  purchaseCost?: string | null;
  map?: string | null;
  availability?: string | null;
  ean?: string | null;
}

export interface PlanOptions {
  /** Currency the file's prices are in, confirmed by the user. */
  currency: string;
  /** false = the vendor quotes MAP net, so it is grossed up by the product's VAT rate. */
  mapIncludesVat: boolean;
  /** A cost moving by more than this fraction is flagged for a human. */
  anomalyPct: number;
}

export interface PlannedChange {
  productId: string;
  mainSku: string;
  title: string;
  field: ChangeField;
  oldValue: string | null;
  newValue: string;
  /** Set when the change is large enough to be worth a second look before applying. */
  warning?: string;
}

export interface Plan {
  changes: PlannedChange[];
  /** Rows that matched a product but proposed nothing — the file agrees with us. */
  unchanged: number;
  /** Values we could not read, e.g. a price cell containing "POA". */
  skipped: Array<{ productId: string; field: ChangeField; raw: string; why: string }>;
}

const money = (v: number) => v.toFixed(4).replace(/\.?0+$/, '');
const barcode = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');

/**
 * Build the change list.
 *
 * Only genuine differences become changes: re-applying last month's file should propose nothing,
 * and a run full of no-op "changes" would bury the handful that matter.
 */
export function buildPlan(rows: PlanRowInput[], products: Map<string, PlanProduct>, opts: PlanOptions): Plan {
  const changes: PlannedChange[] = [];
  const skipped: Plan['skipped'] = [];
  let unchanged = 0;

  for (const row of rows) {
    const p = products.get(row.productId);
    if (!p) continue;
    const before = changes.length;

    // --- purchase cost -----------------------------------------------------
    if (row.purchaseCost != null && String(row.purchaseCost).trim() !== '') {
      const n = toNumber(row.purchaseCost);
      if (n == null || n <= 0) {
        skipped.push({ productId: p.id, field: 'purchaseCost', raw: String(row.purchaseCost), why: 'not a price' });
      } else {
        const sameCurrency = (p.purchaseCostCurrency || 'EUR').toUpperCase() === opts.currency.toUpperCase();
        const old = p.purchaseCostAmount;
        if (!sameCurrency || old == null || Math.abs(old - n) > 0.00005) {
          const change: PlannedChange = {
            productId: p.id, mainSku: p.mainSku, title: p.title, field: 'purchaseCost',
            oldValue: old != null ? `${money(old)} ${p.purchaseCostCurrency}` : null,
            newValue: `${money(n)} ${opts.currency.toUpperCase()}`,
          };
          // A cost that moves a long way is usually a mapping or currency mistake, not a price rise.
          if (old != null && old > 0 && sameCurrency) {
            const delta = (n - old) / old;
            if (Math.abs(delta) >= opts.anomalyPct) {
              change.warning = `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}% vs current cost`;
            }
          } else if (old != null && !sameCurrency) {
            change.warning = `currency changes from ${p.purchaseCostCurrency} to ${opts.currency.toUpperCase()}`;
          }
          changes.push(change);
        }
      }
    }

    // --- MAP ---------------------------------------------------------------
    if (row.map != null && String(row.map).trim() !== '') {
      const n = toNumber(row.map);
      if (n == null || n <= 0) {
        skipped.push({ productId: p.id, field: 'map', raw: String(row.map), why: 'not a price' });
      } else if (!opts.mapIncludesVat && p.vatRatePct == null) {
        // The vendor quotes net and we have no rate to gross it up with. Storing the net figure
        // as a shelf price would understate it by the VAT rate on every affected product.
        skipped.push({ productId: p.id, field: 'map', raw: String(row.map), why: 'vendor quotes MAP net and this product has no VAT class' });
      } else {
        const gross = opts.mapIncludesVat ? n : n * (1 + (p.vatRatePct ?? 0) / 100);
        const sameCurrency = (p.mapCurrency || 'EUR').toUpperCase() === opts.currency.toUpperCase();
        const old = p.mapAmount;
        if (!sameCurrency || old == null || Math.abs(old - gross) > 0.005) {
          changes.push({
            productId: p.id, mainSku: p.mainSku, title: p.title, field: 'map',
            oldValue: old != null ? `${money(old)} ${p.mapCurrency}` : null,
            newValue: `${money(Number(gross.toFixed(4)))} ${opts.currency.toUpperCase()}`,
            ...(opts.mapIncludesVat ? {} : { warning: `grossed up by ${p.vatRatePct}% VAT` }),
          });
        }
      }
    }

    // --- availability ------------------------------------------------------
    if (row.availability != null && String(row.availability).trim() !== '') {
      const n = toNumber(row.availability);
      if (n == null || n < 0 || !Number.isInteger(n)) {
        skipped.push({ productId: p.id, field: 'availability', raw: String(row.availability), why: 'not a whole quantity' });
      } else if ((p.availability ?? 0) !== n) {
        changes.push({
          productId: p.id, mainSku: p.mainSku, title: p.title, field: 'availability',
          oldValue: p.availability != null ? String(p.availability) : null,
          newValue: String(n),
        });
      }
    }

    // --- barcode -----------------------------------------------------------
    // The vendor's barcode is taken as authoritative: they source the article, and a barcode we
    // hold that disagrees with theirs is more often ours being stale than theirs being wrong.
    // Filling an empty one is uncontroversial; replacing a different one is flagged.
    const bc = barcode(row.ean);
    if (bc) {
      const ourEan = barcode(p.ean);
      const ourUpc = barcode(p.upc);
      const knownHere = [ourEan, ourUpc].filter(Boolean);
      const alreadyHeld = knownHere.some((k) => k === bc || k.padStart(13, '0') === bc.padStart(13, '0'));
      if (!alreadyHeld) {
        // A 12-digit code is a UPC; anything else goes in the EAN column.
        const field: ChangeField = bc.length === 12 ? 'upc' : 'ean';
        const old = field === 'upc' ? p.upc : p.ean;
        changes.push({
          productId: p.id, mainSku: p.mainSku, title: p.title, field,
          oldValue: old ?? null,
          newValue: bc,
          ...(old ? { warning: 'replaces a different barcode we already hold' } : {}),
        });
      }
    }

    if (changes.length === before) unchanged += 1;
  }

  return { changes, unchanged, skipped };
}

/** Group a plan for display: how many of each field, and how many carry a warning. */
export function summarisePlan(plan: Plan) {
  const byField: Record<ChangeField, number> = { purchaseCost: 0, map: 0, availability: 0, ean: 0, upc: 0 };
  for (const c of plan.changes) byField[c.field] += 1;
  return {
    total: plan.changes.length,
    byField,
    warnings: plan.changes.filter((c) => c.warning).length,
    unchanged: plan.unchanged,
    skipped: plan.skipped.length,
  };
}
