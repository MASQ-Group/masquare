import { describe, expect, it } from 'vitest';
import { eurToCents } from '../common/money';

/**
 * The euro figure quoted beside a marketplace's own currency.
 *
 * Every listing card — the product card's launch price, the competitor panel beside it, and the
 * sweep on Channel Listings — quotes profit in the marketplace's currency. That answers "is this
 * price any good here" and nothing else: SEK 180 profit and £14 profit cannot be compared, and the
 * company reports in euro regardless.
 *
 * So `quoteForNewListing` converts the profit itself and hands the euro figure to every caller.
 * Two rules hold it together, and this pins both:
 *
 *  1. ONE rate. The euro profit uses exactly the rate the COGS came in on. The quote converts EUR
 *     costs INTO the marketplace currency to solve; converting the answer back at any other rate
 *     would make the euro profit disagree with the euro cost it was derived from.
 *  2. ONE conversion. It happens in the engine, never in a card. Three cards each doing their own
 *     arithmetic is three answers to "what does this earn", which is the disagreement the platform
 *     is not allowed to have.
 */

/** floor.service, costing direction: EUR cost → marketplace currency. */
const cogsNativeCents = (cogsEur: number, eurPerUnit: number) => eurToCents(cogsEur / eurPerUnit);

/** floor.service, reporting direction: a marketplace-currency profit → euro. */
const profitEurCents = (profitCents: number, eurPerUnit: number) => Math.round(profitCents * eurPerUnit);

describe('profit quoted in euro', () => {
  const GBP = 1.1681; // 1 GBP = 1.1681 EUR
  const SEK = 0.088;  // 1 SEK ≈ 0.088 EUR

  it('returns to within a cent of the euro it was costed from', () => {
    // €14.56 becomes £12.46, and £12.46 comes back as €14.55 — a cent short, because the trip out
    // rounded to whole pence and the penny cannot be un-rounded. That is the honest limit of the
    // figure, and it is pinned here so nobody later "fixes" it into a false exactness or lets it
    // widen into something a person would notice.
    const native = cogsNativeCents(14.56, GBP);
    expect(native).toBe(1246);
    expect(Math.abs(profitEurCents(native, GBP) - eurToCents(14.56))).toBeLessThanOrEqual(1);
  });

  it('reports a stronger currency as MORE euros', () => {
    // £12.46 profit is worth more than €12.46 — a pound buys more.
    expect(profitEurCents(1246, GBP)).toBe(1455);
    expect(profitEurCents(1246, GBP)).toBeGreaterThan(1246);
  });

  it('reports a weaker currency as FEWER euros', () => {
    // 16,545 öre ≈ €14.56. A card showing "165.45" beside a €14 cost would read as a windfall.
    expect(profitEurCents(16545, SEK)).toBe(1456);
    expect(profitEurCents(16545, SEK)).toBeLessThan(16545);
  });

  it('leaves a euro marketplace untouched', () => {
    // Amazon DE quotes euro already. The card suppresses the second figure; the number behind it
    // must still be the same one, not a rounded copy that drifts by a cent.
    expect(profitEurCents(1456, 1)).toBe(1456);
  });

  it('carries a loss across as a loss', () => {
    // The cards render the sign themselves, so the signed value has to survive the conversion —
    // an abs() in the engine would turn every loss into a profit on screen.
    expect(profitEurCents(-1246, GBP)).toBe(-1455);
    expect(profitEurCents(-1246, GBP)).toBeLessThan(0);
  });

  it('rounds to whole cents, so no card renders a fraction of a cent', () => {
    expect(Number.isInteger(profitEurCents(1247, GBP))).toBe(true);
    expect(Number.isInteger(profitEurCents(16546, SEK))).toBe(true);
  });
});
