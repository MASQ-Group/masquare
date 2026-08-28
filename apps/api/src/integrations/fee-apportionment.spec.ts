import { describe, expect, it } from 'vitest';

/**
 * Amazon reports fees per shipment item; we bucket them by SKU and put them on our line items.
 *
 * That worked while each line was a different SKU. Amazon splits an order across shipments, and
 * then the same SKU lands on several lines — at which point writing the SKU's whole fee to each
 * line multiplied the fee by the number of lines.
 *
 * Order 113-3702346-5844230 is the case that surfaced it: 6 units of IT51015-FBA over 3 lines
 * (1 + 4 + 1). Amazon charged $5.39 referral and $3.32 FBA per unit — $32.34 and $19.92 for the
 * order — and the platform recorded $97.02 and the euro equivalent of $59.76. Exactly 3x, and the
 * order read as a €23.93 loss instead of a profit.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** splitFee, as the service applies it. */
function splitFee(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [round2(total)];
  const sum = weights.reduce((s, w) => s + w, 0);
  const basis = sum > 0 ? weights : weights.map(() => 1);
  const basisSum = sum > 0 ? sum : n;
  const parts = basis.map((w) => round2((total * w) / basisSum));
  const drift = round2(total - parts.reduce((s, v) => s + v, 0));
  if (drift !== 0) {
    let heaviest = 0;
    for (let i = 1; i < basis.length; i++) if (basis[i] > basis[heaviest]) heaviest = i;
    parts[heaviest] = round2(parts[heaviest] + drift);
  }
  return parts;
}

type Bucket = { bySku: Map<string, number>; total: number };

/** attributeFees, as the service applies it. */
function attributeFees<T>(
  items: T[],
  bucket: Bucket,
  skuOf: (it: T) => string | null,
  weightOf: (it: T) => number,
): number[] {
  const out = new Array<number>(items.length).fill(0);
  const linesBySku = new Map<string, number[]>();
  items.forEach((it, i) => {
    const sku = skuOf(it) ?? '';
    const list = linesBySku.get(sku) ?? [];
    list.push(i);
    linesBySku.set(sku, list);
  });
  let attributed = 0;
  for (const [sku, idxs] of linesBySku) {
    const total = bucket.bySku.get(sku) ?? 0;
    if (total === 0) continue;
    const parts = splitFee(total, idxs.map((i) => weightOf(items[i])));
    idxs.forEach((i, k) => { out[i] = parts[k]; attributed = round2(attributed + parts[k]); });
  }
  const remainder = round2(bucket.total - attributed);
  if (remainder > 0 && out.length) out[0] = round2(out[0] + remainder);
  return out;
}

type Line = { sku: string; quantity: number; netSalesAmount: number };
const sum = (xs: number[]) => round2(xs.reduce((s, v) => s + v, 0));

describe('order 113-3702346-5844230', () => {
  // 3 lines, one SKU, 6 units at $35.94 each.
  const lines: Line[] = [
    { sku: 'IT51015-FBA', quantity: 1, netSalesAmount: 35.94 },
    { sku: 'IT51015-FBA', quantity: 4, netSalesAmount: 143.76 },
    { sku: 'IT51015-FBA', quantity: 1, netSalesAmount: 35.94 },
  ];
  const referral: Bucket = { bySku: new Map([['IT51015-FBA', 32.34]]), total: 32.34 };
  const fba: Bucket = { bySku: new Map([['IT51015-FBA', 19.92]]), total: 19.92 };

  it('books the referral fee Amazon actually charged, not three times it', () => {
    const out = attributeFees(lines, referral, (l) => l.sku, (l) => l.netSalesAmount);
    expect(sum(out)).toBe(32.34);
    // Per unit, which is what Amazon's transaction view shows.
    expect(out).toEqual([5.39, 21.56, 5.39]);
  });

  it('books the FBA fee once, split by units', () => {
    const out = attributeFees(lines, fba, (l) => l.sku, (l) => l.quantity);
    expect(sum(out)).toBe(19.92);
    expect(out).toEqual([3.32, 13.28, 3.32]);
  });

  it('no longer multiplies by the number of lines', () => {
    // What the bug produced: the SKU's whole fee on every line.
    const buggy = lines.map(() => referral.bySku.get('IT51015-FBA') ?? 0);
    expect(sum(buggy)).toBe(97.02);
    expect(sum(attributeFees(lines, referral, (l) => l.sku, (l) => l.netSalesAmount))).toBe(32.34);
  });
});

describe('splitting a fee', () => {
  it('leaves a single line whole', () => {
    expect(splitFee(32.34, [6])).toEqual([32.34]);
  });

  it('always adds back to the exact total', () => {
    // Thirds do not divide cleanly; the parts must still sum to what Amazon charged.
    const parts = splitFee(10, [1, 1, 1]);
    expect(sum(parts)).toBe(10);
    // Ties go to the first line — arbitrary but deterministic, so a re-run cannot move a cent.
    expect(parts).toEqual([3.34, 3.33, 3.33]);
  });

  it('puts the rounding remainder on the heaviest line', () => {
    // The biggest line absorbs the cent, where it is proportionally smallest.
    const parts = splitFee(10, [1, 8, 1]);
    expect(sum(parts)).toBe(10);
    expect(parts[1]).toBeGreaterThan(parts[0]);
  });

  it('splits evenly when there is nothing to weigh by', () => {
    // Zero quantities and zero net sales should not send the whole fee to one line.
    expect(splitFee(9, [0, 0, 0])).toEqual([3, 3, 3]);
  });
});

describe('an order with several SKUs', () => {
  const lines: Line[] = [
    { sku: 'AAA', quantity: 1, netSalesAmount: 10 },
    { sku: 'BBB', quantity: 2, netSalesAmount: 40 },
    { sku: 'AAA', quantity: 3, netSalesAmount: 30 },
  ];
  const bucket: Bucket = { bySku: new Map([['AAA', 6], ['BBB', 8]]), total: 14 };

  it('keeps each SKU to its own lines', () => {
    const out = attributeFees(lines, bucket, (l) => l.sku, (l) => l.netSalesAmount);
    expect(round2(out[0] + out[2])).toBe(6);
    expect(out[1]).toBe(8);
    expect(sum(out)).toBe(14);
  });

  it('is unchanged where every SKU sits on one line', () => {
    // The case that always worked must keep working, to the cent.
    const single: Line[] = [
      { sku: 'AAA', quantity: 1, netSalesAmount: 10 },
      { sku: 'BBB', quantity: 2, netSalesAmount: 40 },
    ];
    expect(attributeFees(single, bucket, (l) => l.sku, (l) => l.netSalesAmount)).toEqual([6, 8]);
  });

  it('keeps a fee whose SKU matches no line', () => {
    // Amazon charged it against this order, so dropping it would understate the cost.
    const orphan: Bucket = { bySku: new Map([['GONE', 5]]), total: 5 };
    const out = attributeFees(lines, orphan, (l) => l.sku, (l) => l.netSalesAmount);
    expect(sum(out)).toBe(5);
    expect(out[0]).toBe(5);
  });

  it('adds an unmatched remainder on top of a line that was already attributed', () => {
    const mixed: Bucket = { bySku: new Map([['AAA', 6], ['GONE', 4]]), total: 10 };
    const out = attributeFees(lines, mixed, (l) => l.sku, (l) => l.netSalesAmount);
    expect(sum(out)).toBe(10);
  });
});

describe('an order with no fees', () => {
  it('writes nothing', () => {
    const lines: Line[] = [{ sku: 'AAA', quantity: 1, netSalesAmount: 10 }];
    const empty: Bucket = { bySku: new Map(), total: 0 };
    expect(attributeFees(lines, empty, (l) => l.sku, (l) => l.netSalesAmount)).toEqual([0]);
  });
});
