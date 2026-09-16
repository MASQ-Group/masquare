import { describe, expect, it } from 'vitest';
import { dayOf, foldDay, type PriceEvent, type SaleEvent } from './daily-fold';

const at = (hhmm: string) => new Date(`2026-09-16T${hhmm}:00Z`);
const price = (hhmm: string, priceCents: number, source = 'repricer'): PriceEvent => ({ at: at(hhmm), priceCents, source });
const sale = (hhmm: string, units = 1, revenueCents = 3000, profitCents = 900): SaleEvent =>
  ({ at: at(hhmm), units, revenueCents, profitCents, feeBasis: 'actual' });
const EMPTY = { decisions: [], prices: [], samples: [], sales: [] };

describe('foldDay — decisions', () => {
  it('counts each outcome, and vetoes separately', () => {
    const d = foldDay({
      ...EMPTY,
      decisions: [
        { at: at('01:00'), outcome: 'PRICED', vetoed: false },
        { at: at('02:00'), outcome: 'PRICED', vetoed: true },
        { at: at('03:00'), outcome: 'HELD', vetoed: false },
        { at: at('04:00'), outcome: 'SKIPPED', vetoed: false },
        { at: at('05:00'), outcome: 'QUARANTINED', vetoed: false },
      ],
    });
    expect(d).toMatchObject({ evaluations: 5, priced: 2, held: 1, skipped: 1, quarantined: 1, vetoed: 1 });
  });
});

describe('foldDay — prices', () => {
  it('opens at yesterday’s price and closes at the last of the day', () => {
    const d = foldDay({ ...EMPTY, prices: [price('09:00', 2500), price('15:00', 2400)], priceBeforeDayCents: 2600 });
    expect(d).toMatchObject({ priceOpenCents: 2600, priceCloseCents: 2400, priceMinCents: 2400, priceMaxCents: 2600, priceChanges: 2 });
  });

  it('keeps yesterday’s price on a day with no change at all', () => {
    expect(foldDay({ ...EMPTY, priceBeforeDayCents: 2600 })).toMatchObject({ priceOpenCents: 2600, priceCloseCents: 2600, priceChanges: 0 });
  });

  /** Only our own changes are repricing; a sync or a hand edit is history, not a reprice. */
  it('counts only the repricer’s own changes', () => {
    const d = foldDay({ ...EMPTY, prices: [price('09:00', 2500), price('10:00', 2500, 'listing_sync'), price('11:00', 2300, 'manual_push')] });
    expect(d.priceChanges).toBe(1);
    expect(d.priceMinCents).toBe(2300); // but every price we saw counts toward the range
  });
});

describe('foldDay — market position', () => {
  it('counts Buy Box wins and time at the floor', () => {
    const d = foldDay({
      ...EMPTY,
      samples: [
        { at: at('01:00'), ourPriceCents: 2500, weHoldBuyBox: true, floorCents: 2300 },
        { at: at('02:00'), ourPriceCents: 2300, weHoldBuyBox: false, floorCents: 2300 },
        { at: at('03:00'), ourPriceCents: null, weHoldBuyBox: false, floorCents: 2300 },
      ],
    });
    expect(d).toMatchObject({ buyBoxSamples: 3, buyBoxWon: 1, atFloorSamples: 1 });
  });
});

describe('foldDay — sales', () => {
  it('adds up units, revenue and profit', () => {
    const d = foldDay({ ...EMPTY, sales: [sale('10:00'), sale('11:00', 2, 6000, 1800)] });
    expect(d).toMatchObject({ unitsSold: 3, revenueCents: 9000, profitCents: 2700, feeBasis: 'actual' });
  });

  it('reports no profit rather than zero when nothing sold', () => {
    expect(foldDay(EMPTY)).toMatchObject({ unitsSold: 0, revenueCents: 0, profitCents: null, feeBasis: null });
  });

  it('says when a day mixes settled and estimated fees', () => {
    const d = foldDay({ ...EMPTY, sales: [sale('10:00'), { ...sale('11:00'), feeBasis: 'estimated' }] });
    expect(d.feeBasis).toBe('mixed');
  });
});

describe('foldDay — sales that followed a price change', () => {
  it('counts units sold within the window after our change', () => {
    const d = foldDay({ ...EMPTY, prices: [price('09:00', 2400)], sales: [sale('10:00', 2), sale('08:00', 5)] });
    expect(d.unitsAfterChange).toBe(2); // the 08:00 sale came before the change
  });

  it('stops counting once the window has passed', () => {
    const d = foldDay({ ...EMPTY, prices: [price('01:00', 2400)], sales: [sale('20:00')], attributionHours: 6 });
    expect(d.unitsAfterChange).toBe(0);
  });

  /** A change late yesterday is why this morning's sales happened, so it must carry over. */
  it('counts a change from yesterday that is still inside the window', () => {
    const yesterday: PriceEvent = { at: new Date('2026-09-15T23:00:00Z'), priceCents: 2400, source: 'repricer' };
    const d = foldDay({ ...EMPTY, changesBeforeDay: [yesterday], sales: [sale('02:00', 3)] });
    expect(d.unitsAfterChange).toBe(3);
  });
});

describe('dayOf', () => {
  it('keys a moment by its UTC day', () => {
    expect(dayOf(new Date('2026-09-16T23:59:59Z')).toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(dayOf(new Date('2026-09-17T00:00:01Z')).toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });
});
