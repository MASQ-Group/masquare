import { describe, expect, it } from 'vitest';
import { currencyForMarketplace } from './amazon-listing.service';

/**
 * Regression cover for a listing that went live unbuyable.
 *
 * A first offer on Amazon UK was submitted denominated in EUR, because the currency was read from
 * an existing ChannelListing and a first offer has none — so it fell through to a EUR default.
 * Amazon accepted the submission, stored it, raised no issue, and left the listing DISCOVERABLE
 * rather than BUYABLE: it had a product but no price it could sell at.
 *
 * The lesson these tests hold in place: the marketplace decides the currency, and nothing else may.
 */
describe('currencyForMarketplace', () => {
  it('gives each marketplace its own currency, never a euro default', () => {
    expect(currencyForMarketplace('UK')).toBe('GBP');
    expect(currencyForMarketplace('US')).toBe('USD');
    expect(currencyForMarketplace('JP')).toBe('JPY');
    expect(currencyForMarketplace('AU')).toBe('AUD');
    expect(currencyForMarketplace('SE')).toBe('SEK');
    expect(currencyForMarketplace('PL')).toBe('PLN');
    expect(currencyForMarketplace('DE')).toBe('EUR');
  });

  it('ignores a fallback whenever the marketplace is known', () => {
    // The exact shape of the original bug: a stale or absent listing currency must not win.
    expect(currencyForMarketplace('UK', 'EUR')).toBe('GBP');
    expect(currencyForMarketplace('JP', 'EUR')).toBe('JPY');
  });

  it('accepts either casing, since channel codes are stored inconsistently', () => {
    expect(currencyForMarketplace('uk')).toBe('GBP');
    expect(currencyForMarketplace('Gb')).toBe('GBP');
  });

  it('falls back only when the marketplace is genuinely unknown', () => {
    expect(currencyForMarketplace(null, 'GBP')).toBe('GBP');
    expect(currencyForMarketplace('ZZ')).toBe('EUR');
  });

  it('covers every marketplace the platform can list on', () => {
    // If a marketplace is added to the id map without a currency, an offer there would be priced in
    // euros and silently fail the same way. This is the guard against that.
    const listable = ['US', 'CA', 'MX', 'BR', 'UK', 'GB', 'IE', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE',
      'SE', 'PL', 'TR', 'EG', 'SA', 'AE', 'IN', 'ZA', 'JP', 'AU', 'SG'];
    for (const iso of listable) {
      // No fallback supplied: an unmapped marketplace would surface as the EUR default here.
      const ccy = currencyForMarketplace(iso);
      expect(ccy, `${iso} has no currency mapped`).toMatch(/^[A-Z]{3}$/);
      if (!['IE', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE'].includes(iso)) {
        expect(ccy, `${iso} fell through to the euro default`).not.toBe('EUR');
      }
    }
  });
});
