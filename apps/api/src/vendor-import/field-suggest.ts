import { DetectedColumn } from './sheet-extract';
import { ValueKind } from './value-kind';

// Suggest which column is which field. A SUGGESTION only — the user confirms it against real
// sample values in the mapping step, because neither signal is reliable alone: across the five
// sample price lists "No.", "ITEM", "Model" and "Code" all meant SKU, while "MODEL" meant the
// manufacturer's part number in files that also had their own SKU column.

export type VendorField = 'sku' | 'ean' | 'manufacturerSku' | 'purchaseCost' | 'map' | 'availability';

export const VENDOR_FIELDS: VendorField[] = ['sku', 'ean', 'manufacturerSku', 'purchaseCost', 'map', 'availability'];

/** Header words that point at a field, most specific first. Matched case-insensitively. */
const HEADER_HINTS: Record<VendorField, string[]> = {
  // "item" and "no." are weak on their own but decisive in files that have nothing better.
  // "model" is last on purpose: it usually names the manufacturer's part number, but in a file
  // with no other identifier it IS the SKU. Ranked below every real SKU word so it only wins when
  // nothing better exists, and below manufacturerSku's exact "model" match when both compete.
  sku: ['sku', 'item no', 'item code', 'itemno', 'item', 'no.', 'code', 'product code', 'part no', 'model'],
  ean: ['ean', 'barcode', 'bar code', 'upc', 'gtin'],
  manufacturerSku: ['manufacturer', 'mfr', 'model', 'mpn', 'part number'],
  // Dealer/wholesale price. "net" and "wls" are what two of the sample files call it.
  purchaseCost: ['dl.price', 'dl price', 'dealer', 'dp ', 'dp(', 'dp', 'wls', 'wholesale', 'net', 'cost', 'buy', 'purchase'],
  // Suggested retail. Never the same column as the dealer price, which the exclusion below relies on.
  map: ['srp', 'rrp', 'msrp', 'ret', 'retail', 'map', 'list price', 'suggested'],
  availability: ['stock', 'qty', 'quantity', 'availability', 'available', 'on hand', 'free'],
};

// How well a value shape fits a field, 0..1. Weighted rather than yes/no: an identifier-shaped
// column beats a prose column for SKU even when neither header says anything, which is what
// separates "Model" (BE-BC27) from "Description" in a file whose headers give no other clue.
const KIND_FIT: Record<VendorField, Partial<Record<ValueKind, number>>> = {
  sku: { sku: 1, text: 0.35 },
  ean: { ean: 1 },
  manufacturerSku: { sku: 1, text: 0.35 },
  // A price is usually decimal, but a whole-number price list is common enough to allow.
  purchaseCost: { money: 1, integer: 0.7 },
  map: { money: 1, integer: 0.7 },
  availability: { integer: 1 },
};

/**
 * Fields are assigned in this order, not in order of confidence.
 *
 * SKU is the identity column — without it nothing can be matched — so it gets first refusal on
 * whatever it fits. manufacturerSku is last because it is the one field that is optional AND
 * competes for the same columns as SKU.
 */
const ASSIGN_ORDER: VendorField[] = ['sku', 'ean', 'availability', 'purchaseCost', 'map', 'manufacturerSku'];

/** Below this a suggestion is dropped rather than offered. A blank the user fills is safe; a
 *  wrong value they tick past is not, and a pre-filled mapping invites exactly that. */
const MIN_CONFIDENCE = 0.35;

export interface FieldSuggestion {
  field: VendorField;
  /** Index into the columns array, or null when nothing is a credible match. */
  columnIndex: number | null;
  confidence: number;
  reason: string;
}

function headerScore(header: string, field: VendorField): { score: number; hit: string | null } {
  const h = header.trim().toLowerCase();
  if (!h) return { score: 0, hit: null };
  const hints = HEADER_HINTS[field];
  for (let i = 0; i < hints.length; i++) {
    const hint = hints[i];
    if (h === hint) return { score: 1, hit: hint };
    if (h.includes(hint)) {
      // Earlier hints are more specific, so they score higher; a substring scores below an exact hit.
      return { score: 0.75 - i * 0.02, hit: hint };
    }
  }
  return { score: 0, hit: null };
}

/**
 * Suggest a column for every field.
 *
 * Assigned greedily by confidence, one column per field: dealer price and suggested retail look
 * identical by value shape, so the stronger header claim takes its column and the other must
 * choose elsewhere. That single rule is what keeps cost and MAP from both landing on the same
 * money column, which would silently price everything at retail.
 */
export function suggestMapping(columns: DetectedColumn[]): FieldSuggestion[] {
  const scored: Array<{ field: VendorField; columnIndex: number; confidence: number; reason: string }> = [];

  columns.forEach((col, idx) => {
    for (const field of VENDOR_FIELDS) {
      const fit = KIND_FIT[field][col.kind] ?? 0;
      const { score: hScore, hit } = headerScore(col.header, field);
      if (fit === 0 && hScore === 0) continue;

      // Header carries most of the weight; the value shape confirms or undercuts it.
      let confidence = hScore * 0.7 + fit * 0.3;
      // A column that is mostly blank is a poor candidate whatever it is called.
      confidence *= 0.5 + 0.5 * Math.min(1, col.filled * 1.25);
      // An EAN shape is unmistakable, so trust it even when the header says nothing.
      if (field === 'ean' && col.kind === 'ean') confidence = Math.max(confidence, 0.85);

      if (confidence < MIN_CONFIDENCE) continue;
      const reason = hit
        ? `header "${col.header}" matches "${hit}"${fit > 0 ? ` and values look like ${col.kind}` : ''}`
        : `values look like ${col.kind}`;
      scored.push({ field, columnIndex: idx, confidence: Number(confidence.toFixed(3)), reason });
    }
  });

  scored.sort((a, b) => b.confidence - a.confidence);
  const takenColumn = new Set<number>();
  const chosen = new Map<VendorField, { columnIndex: number; confidence: number; reason: string }>();
  for (const field of ASSIGN_ORDER) {
    const best = scored.find((s) => s.field === field && !takenColumn.has(s.columnIndex));
    if (!best) continue;
    takenColumn.add(best.columnIndex);
    chosen.set(field, best);
  }

  return VENDOR_FIELDS.map((field) => {
    const c = chosen.get(field);
    return c
      ? { field, columnIndex: c.columnIndex, confidence: c.confidence, reason: c.reason }
      : { field, columnIndex: null, confidence: 0, reason: 'no column matched' };
  });
}

/** What the file can update, from what was actually mapped. */
export function capabilitiesOf(suggestions: FieldSuggestion[]): { cost: boolean; map: boolean; availability: boolean } {
  const has = (f: VendorField) => suggestions.some((s) => s.field === f && s.columnIndex != null);
  return { cost: has('purchaseCost'), map: has('map'), availability: has('availability') };
}
