// Integer-cents median. Used for the trailing Buy-Box reference price behind the anomalous-
// competitor guard (§6.1) and the fair-pricing ceiling (§6.2). Pure, so it is unit-tested in
// isolation. Even-length sets average the two middle values and round to the nearest cent.

export function medianCents(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
