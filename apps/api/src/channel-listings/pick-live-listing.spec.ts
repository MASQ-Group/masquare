import { describe, expect, it } from 'vitest';
import { pickLiveListing, pickLiveListingsByKey } from './pick-live-listing';

/** The two rows Amazon UK returns for IT68277, as stored. */
const live = {
  channelSku: 'IT68277', listingStatus: 'BUYABLE,DISCOVERABLE', listedQuantity: 19,
  listedPrice: 390, asin: 'B0CTKK5WHR', externalListingId: null,
  lastPulledAt: new Date('2026-09-11T11:14:00Z'),
};
const stub = {
  channelSku: 'IT-68277', listingStatus: '', listedQuantity: null,
  listedPrice: null, asin: null, externalListingId: null,
  lastPulledAt: new Date('2026-09-11T11:14:00Z'),
};

describe('pickLiveListing', () => {
  /** The defect, in one assertion: 19 units at £390 displayed as Paused with no stock. */
  it('picks the listing over an empty SKU, whichever order they arrive in', () => {
    expect(pickLiveListing([stub, live])?.channelSku).toBe('IT68277');
    expect(pickLiveListing([live, stub])?.channelSku).toBe('IT68277');
  });

  it('returns the only row when there is one, and nothing when there are none', () => {
    expect(pickLiveListing([stub])?.channelSku).toBe('IT-68277');
    expect(pickLiveListing([])).toBeUndefined();
  });

  /**
   * An out-of-stock listing is still the listing. Ranking it under an empty stub would swap one
   * wrong answer for another — the card would show a SKU nobody can buy in place of a real zero.
   */
  it('prefers a real out-of-stock listing to a stub', () => {
    const oos = { ...live, channelSku: 'OOS', listingStatus: 'DISCOVERABLE', listedQuantity: 0 };
    expect(pickLiveListing([stub, oos])?.channelSku).toBe('OOS');
  });

  it('prefers a buyable listing to a merely discoverable one', () => {
    const discoverable = { ...live, channelSku: 'DISC', listingStatus: 'DISCOVERABLE' };
    expect(pickLiveListing([discoverable, live])?.channelSku).toBe('IT68277');
  });

  /**
   * eBay and OnBuy do not report a status at all — null, not empty. Those rows must still count as
   * offers, or every eBay listing would rank as a stub and the tie-break alone would decide.
   */
  it('treats a priced row with no status at all as an offer', () => {
    const ebay = { ...stub, channelSku: 'EB', listingStatus: null, listedPrice: 410, listedQuantity: 19 };
    expect(pickLiveListing([stub, ebay])?.channelSku).toBe('EB');
  });

  /** An ASIN or an eBay ItemID is evidence of an offer even with price and quantity missing. */
  it('counts an identifier as an offer', () => {
    const withAsin = { ...stub, channelSku: 'A', asin: 'B000000000' };
    const withItemId = { ...stub, channelSku: 'B', externalListingId: '1234567890' };
    expect(pickLiveListing([stub, withAsin])?.channelSku).toBe('A');
    expect(pickLiveListing([stub, withItemId])?.channelSku).toBe('B');
  });

  /**
   * Both rows are real offers on the same marketplace — a merchant one out of stock and its FBA
   * sibling, which carries no quantity because Amazon counts that stock. The one with a figure in
   * it is the better answer, and leaving this to the query's order was the original defect.
   */
  it('prefers the row carrying a quantity when neither is buyable', () => {
    const fba = { ...stub, channelSku: 'X-FBA', listingStatus: 'DISCOVERABLE', asin: 'B01' };
    const fbm = { ...stub, channelSku: 'X', listingStatus: 'DISCOVERABLE', listedQuantity: 0, asin: 'B01' };
    expect(pickLiveListing([fba, fbm])?.channelSku).toBe('X');
    expect(pickLiveListing([fbm, fba])?.channelSku).toBe('X');
  });

  /** An FBA-only product has one row, and it is the listing whatever its quantity says. */
  it('still returns an FBA row when it is the only one', () => {
    const fba = { ...stub, channelSku: 'X-FBA', listingStatus: 'DISCOVERABLE', asin: 'B01' };
    expect(pickLiveListing([fba])?.channelSku).toBe('X-FBA');
  });

  it('falls back to the most recently pulled when the rows rank alike', () => {
    const older = { ...live, channelSku: 'OLD', lastPulledAt: new Date('2026-09-01T00:00:00Z') };
    const newer = { ...live, channelSku: 'NEW', lastPulledAt: new Date('2026-09-10T00:00:00Z') };
    expect(pickLiveListing([newer, older])?.channelSku).toBe('NEW');
    expect(pickLiveListing([older, newer])?.channelSku).toBe('NEW');
  });

  /** Two stubs are still a row the channel reported; hiding them would claim "not listed" wrongly. */
  it('returns a stub rather than nothing when every candidate is one', () => {
    expect(pickLiveListing([stub, { ...stub, channelSku: 'OTHER' }])).toBeDefined();
  });

  /**
   * The screens do not all select `lastPulledAt`, so one can tie where another does not. Without a
   * final deterministic step the same product showed a different SKU on two pages — which is the
   * defect this file exists to end, merely moved.
   */
  it('gives the same answer whatever order the rows arrive in, even with nothing to date them by', () => {
    const a = { ...stub, channelSku: 'BE-MG16', listingStatus: 'DISCOVERABLE', listedQuantity: 0, lastPulledAt: null };
    const b = { ...stub, channelSku: 'BE-MG16-R', listingStatus: 'DISCOVERABLE', listedQuantity: 2, lastPulledAt: null };
    expect(pickLiveListing([a, b])?.channelSku).toBe(pickLiveListing([b, a])?.channelSku);
  });

  it('reads a date that arrived as a string, and survives a broken one', () => {
    const a = { ...stub, channelSku: 'A', lastPulledAt: '2026-09-01T00:00:00Z' };
    const b = { ...stub, channelSku: 'B', lastPulledAt: '2026-09-10T00:00:00Z' };
    expect(pickLiveListing([a, b])?.channelSku).toBe('B');
    expect(() => pickLiveListing([{ ...stub, lastPulledAt: 'not a date' }, a])).not.toThrow();
  });
});

describe('pickLiveListingsByKey', () => {
  it('keeps one listing per key, and the right one', () => {
    const rows = [
      { ...stub, key: 'uk' }, { ...live, key: 'uk' },
      { ...live, key: 'es', channelSku: 'IT68277-ES' },
    ];
    const out = pickLiveListingsByKey(rows, (r) => r.key);
    expect(out.size).toBe(2);
    expect(out.get('uk')?.channelSku).toBe('IT68277');
    expect(out.get('es')?.channelSku).toBe('IT68277-ES');
  });

  it('is empty for no rows', () => {
    expect(pickLiveListingsByKey([], () => 'k').size).toBe(0);
  });
});
