/**
 * A listing price's economics in the shape the eBay pricing panel reads, in the listing's currency.
 *
 * The economics come from PricingService — the calculation every listing screen, Individual Pricing
 * and a booked sale share: the sales channel's own fee, its VAT rules (the UK £135 line), the cost and
 * the shipping. eBay used to carry its own model here, and suggested a different price from OnBuy for
 * the same product on two channels set up alike. This only turns the euro figures into the listing's
 * currency, at the rate the economics used — the price in euro over the price in the listing's
 * currency — so the lines add up to the price shown.
 *
 * Margin is profit over the price the buyer pays, as everywhere else on the platform.
 *
 * PURE.
 */
import type { ListingEconomics } from '../../pricing/pricing.service';

export interface EbayPriceOutcome {
  priceCents: number;
  /** VAT taken from that price — none over the UK £135 line. */
  vatCents: number;
  feesCents: number;
  shippingCents: number;
  costCents: number;
  profitCents: number;
  /** Profit as a percentage of the price. Negative when the price does not cover the costs. */
  marginPct: number;
}

export type EbayPriceSuggestion =
  | { ok: true; outcome: EbayPriceOutcome; targetMarginPct: number; problems?: string[] }
  | { ok: false; reason: string };

export function toEbayOutcome(priceCents: number, e: ListingEconomics | undefined): EbayPriceOutcome | null {
  if (!e || e.profitEur == null || e.marginPct == null || !e.priceEur || !(priceCents > 0)) return null;
  const eurPerUnit = e.priceEur / (priceCents / 100);
  const cents = (eur: number | undefined) => Math.round(((eur ?? 0) / eurPerUnit) * 100);
  return {
    priceCents,
    vatCents: cents(e.vatEur),
    feesCents: cents(e.feeEur),
    shippingCents: cents(e.shippingEur),
    costCents: cents(e.costEur),
    profitCents: cents(e.profitEur),
    marginPct: e.marginPct,
  };
}
