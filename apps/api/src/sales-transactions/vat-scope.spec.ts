import { describe, expect, it } from 'vitest';
import { channelThresholdApplies, taxRegimeFor } from './vat-scope';

const uk = { thresholdEnabled: true, thresholdAmount: 135, channelHomeIso: 'GB', destinationIso: 'GB' };

describe('channelThresholdApplies', () => {
  it('governs a sale into the country whose threshold it is', () => {
    expect(channelThresholdApplies(uk)).toBe(true);
  });

  /**
   * The defect this exists to stop. Fourteen production orders — Israel, Taiwan, Turkey, Hong Kong,
   * Albania, Mauritius, the Philippines — each carry a stored 20% against zero actual VAT, because
   * the threshold fired on value alone and outranked the destination's own rate.
   */
  it('does not govern an export to a country with no such rule', () => {
    for (const iso of ['IL', 'TW', 'TR', 'HK', 'AL', 'MU', 'PH']) {
      expect(channelThresholdApplies({ ...uk, destinationIso: iso })).toBe(false);
    }
  });

  /**
   * An EU destination is its own jurisdiction with its own VAT, and the UK's import threshold has
   * nothing to say about it — this is the case where the seller collects and remits.
   */
  it('does not govern a sale from a UK channel into the EU', () => {
    for (const iso of ['DE', 'FR', 'IE', 'ES', 'CY']) {
      expect(channelThresholdApplies({ ...uk, destinationIso: iso })).toBe(false);
    }
  });

  /** Not hardcoded to the UK: another marketplace's own import threshold works the same way. */
  it('works for a channel whose home is not the UK', () => {
    expect(channelThresholdApplies({ ...uk, channelHomeIso: 'DE', destinationIso: 'DE' })).toBe(true);
    expect(channelThresholdApplies({ ...uk, channelHomeIso: 'DE', destinationIso: 'GB' })).toBe(false);
  });

  it('is off when the channel has no threshold configured', () => {
    expect(channelThresholdApplies({ ...uk, thresholdEnabled: false })).toBe(false);
    expect(channelThresholdApplies({ ...uk, thresholdAmount: null })).toBe(false);
  });

  /**
   * An unknown country must not be treated as a match. Falling through to the country rate leaves a
   * missing figure, which somebody can notice and answer; asserting a rate leaves a wrong one, which
   * nobody will.
   */
  it('refuses when either country is unknown', () => {
    expect(channelThresholdApplies({ ...uk, destinationIso: null })).toBe(false);
    expect(channelThresholdApplies({ ...uk, channelHomeIso: null })).toBe(false);
    expect(channelThresholdApplies({ ...uk, destinationIso: '' })).toBe(false);
  });

  it('reads country codes tolerantly', () => {
    expect(channelThresholdApplies({ ...uk, destinationIso: ' gb ' })).toBe(true);
  });
});

describe('taxRegimeFor', () => {
  it('keeps the regimes that are not VAT', () => {
    expect(taxRegimeFor({ isoCode: 'JP' })).toBe('jct');
    expect(taxRegimeFor({ isoCode: 'AU' })).toBe('gst');
    for (const iso of ['US', 'CA', 'MX']) expect(taxRegimeFor({ isoCode: iso })).toBe('sales_tax');
  });

  it('calls the UK and the EU VAT zone VAT', () => {
    expect(taxRegimeFor({ isoCode: 'GB' })).toBe('vat');
    expect(taxRegimeFor({ isoCode: 'DE', euVatZone: true })).toBe('vat');
    expect(taxRegimeFor({ isoCode: 'CY', euVatZone: true })).toBe('vat');
  });

  /**
   * The case that was missing. Calling an export 'vat' made a zero-rated sale look like a domestic
   * one whose VAT had gone unrecorded — which is why fourteen correct orders sat indistinguishable
   * among forty-one broken ones.
   */
  it('calls an export what it is, rather than VAT with nothing in it', () => {
    for (const iso of ['IL', 'TW', 'TR', 'HK', 'AL', 'MU', 'PH', 'CH', 'NO']) {
      expect(taxRegimeFor({ isoCode: iso, euVatZone: false })).toBe('none');
    }
  });

  /** No destination is no regime; nothing may be assumed from an absent country. */
  it('claims nothing without a country', () => {
    expect(taxRegimeFor(null)).toBe('none');
    expect(taxRegimeFor(undefined)).toBe('none');
  });

  /** GB is not in the EU VAT zone and must not depend on that flag being set. */
  it('does not rely on euVatZone for the UK', () => {
    expect(taxRegimeFor({ isoCode: 'GB', euVatZone: false })).toBe('vat');
  });
});
