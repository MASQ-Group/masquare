// What a column's values LOOK like, independent of what its header claims.
//
// Vendor headers are unreliable — "No.", "ITEM", "Model" and "Code" have all meant SKU across the
// five sample files, and "RET", "SRP", "RRP" and "SRP (INC)" have all meant suggested retail. The
// shape of the values is the more dependable signal, so mapping is suggested from both and the
// user confirms against real samples rather than against a column number.

export type ValueKind = 'empty' | 'ean' | 'money' | 'integer' | 'sku' | 'text';

const DIGITS = /^\d+$/;
/** EAN-8, UPC-12, EAN-13 and GTIN-14 are the barcode lengths that actually appear on price lists. */
const EAN_LENGTHS = new Set([8, 12, 13, 14]);
/** Letters and digits with the separators SKUs use, and at least one digit somewhere. */
const SKU_SHAPE = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9._\/-]{2,}$/;

/** Normalise a cell for inspection: trim, and drop thousands separators around a decimal. */
export function normaliseNumeric(raw: string): string {
  const s = raw.trim().replace(/[\s ]/g, '');
  // 1.234,56 (European) -> 1234.56 ; 1,234.56 (English) -> 1234.56
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return s.replace(/\./g, '').replace(',', '.');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return s.replace(/,/g, '');
  if (/^-?\d+,\d+$/.test(s)) return s.replace(',', '.');
  return s;
}

/** A number if the cell is one, else null. Handles numbers stored as text and currency symbols. */
export function toNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const stripped = String(raw).replace(/[€£$]/g, '');
  const s = normaliseNumeric(stripped);
  if (s === '' || !/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Classify one cell. */
export function kindOf(raw: string | null | undefined): ValueKind {
  const s = String(raw ?? '').trim();
  if (s === '') return 'empty';
  if (DIGITS.test(s) && EAN_LENGTHS.has(s.length)) return 'ean';
  const n = toNumber(s);
  if (n != null) {
    // A price is the decimal case; a whole number is more likely a quantity. Both stay
    // ambiguous on their own, which is why the header is weighed alongside this.
    return Number.isInteger(n) && !/[.,]/.test(s) ? 'integer' : 'money';
  }
  return SKU_SHAPE.test(s) ? 'sku' : 'text';
}

/** The dominant kind across a column's values, ignoring blanks. */
export function columnKind(values: Array<string | null | undefined>): ValueKind {
  const counts = new Map<ValueKind, number>();
  let seen = 0;
  for (const v of values) {
    const k = kindOf(v);
    if (k === 'empty') continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    seen += 1;
  }
  if (!seen) return 'empty';
  // An EAN column with a few blanks or a stray note still reads as EAN; require a clear majority.
  let best: ValueKind = 'text';
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return bestN / seen >= 0.6 ? best : 'text';
}
