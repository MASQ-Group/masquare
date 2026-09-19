/**
 * A price's profit, in the shape the Edit price window reads for every channel.
 *
 * The platform's economics come back in euro. The window shows profit in the listing's own currency
 * with the euro beside it, so the listing-currency figure is the euro one scaled by the same rate
 * the economics used — the price in euro over the price in the listing's currency.
 *
 * PURE.
 */
export interface ProfitEntry {
  priceCents: number;
  profitCents: number;
  profitEurCents: number;
  marginPct: number;
  aboveBreakeven: boolean;
}

export function profitEntry(
  priceCents: number,
  e: { profitEur: number | null; marginPct: number | null; priceEur?: number } | undefined,
): ProfitEntry | null {
  if (!e || e.profitEur == null || e.marginPct == null || !e.priceEur || !(priceCents > 0)) return null;
  const eurPerUnit = e.priceEur / (priceCents / 100);
  return {
    priceCents,
    profitCents: Math.round((e.profitEur / eurPerUnit) * 100),
    profitEurCents: Math.round(e.profitEur * 100),
    marginPct: e.marginPct,
    aboveBreakeven: e.profitEur >= 0,
  };
}
