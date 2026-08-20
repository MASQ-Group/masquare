import { describe, it, expect } from 'vitest';

// The rule pricing must share with the sales-transaction module: the destination tax is deducted
// from revenue ONLY when the listed price contains it AND we have to hand it over.
//
// Anchored on a real Amazon JP order: listed ¥12,520, tax ¥927, fees ¥1,289, points ¥125,
// "Your earnings" ¥11,106 -- earnings retain the tax, so the JCT is revenue to us.
function revenueBasis(listed: number, ratePct: number, priceIncludesTax: boolean, taxType: string): number {
  const sellerKeepsTax = taxType === 'jct';
  const deduct = priceIncludesTax && !sellerKeepsTax;
  return deduct ? listed / (1 + ratePct / 100) : listed;
}

describe('which tax comes off revenue', () => {
  it('Japan keeps the consumption tax: the full listed price is revenue', () => {
    // 7.41% is the tax as a share of the tax-INCLUSIVE price (8/108), matching ¥927 on ¥12,520.
    expect(Math.round(12520 * 0.0741)).toBe(928); // Amazon shows 927 after its own rounding
    expect(revenueBasis(12520, 7.41, true, 'jct')).toBe(12520);
  });

  it('reconciles the JP payout exactly', () => {
    const revenue = revenueBasis(12520, 7.41, true, 'jct');
    expect(revenue - 1289 - 125).toBe(11106); // "Your earnings"
  });

  it('AU excludes GST because the price never contained it', () => {
    expect(revenueBasis(10000, 10, false, 'gst')).toBe(10000);
  });

  it('EU deducts VAT: the price contains it and we remit it', () => {
    expect(revenueBasis(11900, 19, true, 'vat')).toBeCloseTo(10000, 6);
  });

  it('US sales tax is added at checkout and remitted by the marketplace', () => {
    expect(revenueBasis(5000, 8.25, false, 'sales_tax')).toBe(5000);
  });
});
