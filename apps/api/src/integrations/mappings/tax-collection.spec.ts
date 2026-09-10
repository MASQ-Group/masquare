import { describe, expect, it } from 'vitest';
import { anyMarketplaceFacilitator, channelRemitsTheVat, isMarketplaceFacilitator } from './tax-collection';

const facilitator = { TaxCollection: { Model: 'MarketplaceFacilitator', ResponsibleParty: 'Amazon Services, Inc.' } };
const standard = { TaxCollection: { Model: 'Standard' } };
/** A line that carried no tax: Amazon omits the block entirely rather than sending an empty one. */
const untaxed = { SellerSKU: 'FREEBIE', QuantityOrdered: 1 };

describe('isMarketplaceFacilitator', () => {
  it('recognises the model Amazon uses when it collects and remits', () => {
    expect(isMarketplaceFacilitator(facilitator)).toBe(true);
  });

  /** Standard means the tax is the seller's to account for — the opposite conclusion. */
  it('does not treat a standard collection as the marketplace collecting', () => {
    expect(isMarketplaceFacilitator(standard)).toBe(false);
  });

  it('handles a line with no TaxCollection block at all', () => {
    expect(isMarketplaceFacilitator(untaxed)).toBe(false);
  });

  /**
   * A payload is JSON from an external API and may be anything. None of these may throw — a crash
   * here would fail a whole order sync over one malformed line.
   */
  it('survives whatever the API sends', () => {
    for (const junk of [null, undefined, {}, [], 'MarketplaceFacilitator', 42, { TaxCollection: null }, { TaxCollection: { Model: null } }, { TaxCollection: { Model: 7 } }]) {
      expect(isMarketplaceFacilitator(junk)).toBe(false);
    }
  });

  /** Exact match: a near-miss must not be read as a claim Amazon did not make. */
  it('does not match a similar-looking model', () => {
    expect(isMarketplaceFacilitator({ TaxCollection: { Model: 'marketplacefacilitator' } })).toBe(false);
    expect(isMarketplaceFacilitator({ TaxCollection: { Model: 'MarketplaceFacilitatorLegacy' } })).toBe(false);
  });
});

describe('anyMarketplaceFacilitator', () => {
  it('flags an order where every line says so', () => {
    expect(anyMarketplaceFacilitator([facilitator, facilitator])).toBe(true);
  });

  /**
   * The reason this is `some` and not `every`. A zero-priced or fully discounted line carries no
   * tax and therefore no TaxCollection block; demanding unanimity would drop the flag from an order
   * Amazon really did collect on, and we would declare output tax on money we never received.
   */
  it('flags the order when one line is untaxed and the rest are collected', () => {
    expect(anyMarketplaceFacilitator([facilitator, untaxed])).toBe(true);
  });

  it('leaves an order alone when nothing claims it', () => {
    expect(anyMarketplaceFacilitator([standard, untaxed])).toBe(false);
  });

  /** No items is no evidence, and no evidence must not become an assertion. */
  it('claims nothing for an empty order', () => {
    expect(anyMarketplaceFacilitator([])).toBe(false);
  });
});

/**
 * The scope rule, which is where I got it wrong: I let the channel's report alone decide, so every
 * facilitator order on every marketplace read as "not our VAT". Amazon is a facilitator for US sales
 * tax, Australian GST and Japanese consumption tax too, and EU-destined sales carry VAT we collect
 * and remit ourselves whatever an API reports.
 */
describe('channelRemitsTheVat', () => {
  const uk = { reportedByChannel: true, destinationIso: 'GB', taxType: 'vat' };

  it('is true for a UK-destined VAT sale the channel says it collected', () => {
    expect(channelRemitsTheVat(uk)).toBe(true);
  });

  /** The half I originally omitted. An EU sale is our liability however Amazon reports it. */
  it('is false for an EU destination even when the channel reported collecting', () => {
    for (const iso of ['DE', 'FR', 'IE', 'ES', 'IT', 'CY']) {
      expect(channelRemitsTheVat({ ...uk, destinationIso: iso })).toBe(false);
    }
  });

  /** A facilitator report about GST or sales tax is not a statement about VAT. */
  it('ignores a report against a different tax regime', () => {
    expect(channelRemitsTheVat({ ...uk, taxType: 'gst', destinationIso: 'AU' })).toBe(false);
    expect(channelRemitsTheVat({ ...uk, taxType: 'jct', destinationIso: 'JP' })).toBe(false);
    expect(channelRemitsTheVat({ ...uk, taxType: 'sales_tax', destinationIso: 'US' })).toBe(false);
  });

  /** Without the channel saying so there is nothing to act on — the threshold must not stand in. */
  it('is false when the channel reported nothing, UK or not', () => {
    expect(channelRemitsTheVat({ ...uk, reportedByChannel: false })).toBe(false);
  });

  it('is false when the destination is unknown', () => {
    expect(channelRemitsTheVat({ ...uk, destinationIso: null })).toBe(false);
    expect(channelRemitsTheVat({ ...uk, destinationIso: '' })).toBe(false);
  });

  /** Stored ISO codes vary in case and padding; the rule must not turn that into a tax decision. */
  it('reads the destination code tolerantly', () => {
    expect(channelRemitsTheVat({ ...uk, destinationIso: 'gb' })).toBe(true);
    expect(channelRemitsTheVat({ ...uk, destinationIso: ' GB ' })).toBe(true);
  });

  /** A missing regime means the ordinary one — VAT — rather than a reason to refuse. */
  it('treats an unset tax type as VAT', () => {
    expect(channelRemitsTheVat({ ...uk, taxType: null })).toBe(true);
  });
});
