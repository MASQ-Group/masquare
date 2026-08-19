// Money in this module is ALWAYS integer minor units (euro cents) + a currency code
// (spec §4.1). The rest of maSquare stores money as Float EUR (e.g. Product.averageCostEur);
// the repricer keeps its own integer-cents discipline to avoid floating-point drift in the
// solver and every competitor comparison, and converts at the ERP boundary (Deviation D-3).
//
// `Cents` is a branded number so a raw euro Float can't be passed where cents are expected
// without going through an explicit converter below.

export type Cents = number & { readonly __brand: 'Cents' };

/** Assert/brand an already-integer cents value. Throws on non-integers to catch drift early. */
export function cents(n: number): Cents {
  if (!Number.isInteger(n)) {
    throw new Error(`Cents must be an integer minor-unit value, got ${n}`);
  }
  return n as Cents;
}

/** Euro Float (the ERP boundary representation) → integer cents. Rounds half-up. */
export function eurToCents(eur: number): Cents {
  return cents(Math.round(eur * 100));
}

/** Integer cents → euro Float, for display / ERP boundary only. */
export function centsToEur(c: Cents): number {
  return c / 100;
}

/** A percentage stored as a Decimal(5,2) in the ERP (e.g. 19.00 = 19%) → a fraction (0.19). */
export function pctToFraction(ratePct: number): number {
  return ratePct / 100;
}
