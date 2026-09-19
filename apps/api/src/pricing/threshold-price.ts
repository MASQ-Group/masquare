/**
 * The lowest price that earns a target margin when the tax rate depends on the price itself.
 *
 * The UK's £135 consignment rule is the case this exists for: at or under it the marketplace collects
 * 20% VAT from the price, over it none. Solving at one rate and then "taking the higher answer if the
 * other side disagrees" overshoots badly — IT33248 was suggested at £254 for 20% on OnBuy when £188.94
 * earns exactly 20%, because the 20%-VAT answer sat over the line where no VAT is taken at all.
 *
 * Each rate's answer only counts if it lands on the side of the line where that rate applies. The
 * lowest such answer wins. When neither does — the below-the-line rate needs a price over the line,
 * and the over-the-line rate is satisfied by a price under it — the first price over the line is the
 * answer: margin rises with price, so it earns at least the target there.
 *
 * PURE. Prices are in EUR; the caller converts.
 */
export interface ThresholdSolve {
  /** Every rate the channel can apply — below and above the line (one entry when there is no line). */
  rates: number[];
  /** The rate that applies at a gross price. */
  vatAt: (grossEur: number) => number;
  /** The gross price that earns the target at a given rate, or null when no price does. */
  solveAt: (vatPct: number) => number | null;
  /** The lowest gross price over the line, or null when the channel has no line. */
  firstAboveEur: number | null;
}

export function lowestPriceForMargin(s: ThresholdSolve): number | null {
  const consistent: number[] = [];
  for (const rate of new Set(s.rates)) {
    const gross = s.solveAt(rate);
    if (gross != null && s.vatAt(gross) === rate) consistent.push(gross);
  }
  if (consistent.length) return Math.min(...consistent);

  if (s.firstAboveEur != null) {
    const needed = s.solveAt(s.vatAt(s.firstAboveEur));
    if (needed != null && needed <= s.firstAboveEur) return s.firstAboveEur;
  }
  return null;
}
