import { describe, expect, it } from 'vitest';
import {
  anyMarketplaceFacilitator, channelRemitsTheVat, isMarketplaceFacilitator, marketplaceRemitsTax,
  withoutChannelCollectedTax,
} from './tax-collection';

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

describe('channelRemitsTheVat', () => {
  const uk = {
    reportedByChannel: true,
    channelConnector: 'amazon',
    channelHomeIso: 'GB',
    destinationIso: 'GB',
    taxType: 'vat',
    belowChannelThreshold: true,
  };

  it('is true for a UK-destined VAT sale the channel says it collected', () => {
    expect(channelRemitsTheVat(uk)).toBe(true);
  });

  /** The half originally omitted. An EU sale is our liability however Amazon reports it. */
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

  it('is false when a reporting channel reported nothing', () => {
    expect(channelRemitsTheVat({ ...uk, reportedByChannel: false })).toBe(false);
    expect(channelRemitsTheVat({ ...uk, reportedByChannel: false, channelConnector: 'ebay' })).toBe(false);
  });

  /**
   * A missing report from Amazon is a fault in the sync, not evidence of anything. Inferring from
   * the threshold there would paper over exactly the gap worth noticing — which is why the
   * exception below is a list of channels and not a rule about absent data.
   */
  it('does not let the threshold stand in for a report Amazon should have sent', () => {
    expect(channelRemitsTheVat({ ...uk, reportedByChannel: false, belowChannelThreshold: true })).toBe(false);
  });

  it('is false when the destination or the channel home is unknown', () => {
    expect(channelRemitsTheVat({ ...uk, destinationIso: null })).toBe(false);
    expect(channelRemitsTheVat({ ...uk, destinationIso: '' })).toBe(false);
    expect(channelRemitsTheVat({ ...uk, channelHomeIso: null })).toBe(false);
  });

  it('reads country codes tolerantly', () => {
    expect(channelRemitsTheVat({ ...uk, destinationIso: ' gb ', channelHomeIso: 'gb' })).toBe(true);
  });

  it('treats an unset tax type as VAT', () => {
    expect(channelRemitsTheVat({ ...uk, taxType: null })).toBe(true);
  });

  /** Both ends must be the UK — an Amazon DE sale into the UK is deliberately excluded. */
  it('needs the selling channel to be the UK one, not just the destination', () => {
    for (const iso of ['DE', 'FR', 'US', 'IE']) {
      expect(channelRemitsTheVat({ ...uk, channelHomeIso: iso })).toBe(false);
    }
  });

  /**
   * OnBuy collects under the threshold but has no field in which to say so — no equivalent of
   * Amazon's TaxCollection or eBay's collect-and-remit lines. Held to the report like the others,
   * every OnBuy order would read as our liability when none of it is.
   */
  describe('OnBuy, which never reports', () => {
    const onbuy = { ...uk, channelConnector: 'onbuy', reportedByChannel: false };

    it('is true under the threshold, on the evidence of the threshold alone', () => {
      expect(channelRemitsTheVat(onbuy)).toBe(true);
    });

    /**
     * Above £135 OnBuy does not collect, and a channel with no threshold configured is not "under"
     * it either. Nothing known means nothing claimed — this is the only evidence OnBuy gives us,
     * and its absence is not a yes.
     */
    it('is false above the threshold, and when no threshold is configured', () => {
      expect(channelRemitsTheVat({ ...onbuy, belowChannelThreshold: false })).toBe(false);
    });

    /** The exception is about the missing report, not about OnBuy escaping the other rules. */
    it('still needs a UK channel, a UK destination and a VAT regime', () => {
      expect(channelRemitsTheVat({ ...onbuy, destinationIso: 'DE' })).toBe(false);
      expect(channelRemitsTheVat({ ...onbuy, channelHomeIso: 'DE' })).toBe(false);
      expect(channelRemitsTheVat({ ...onbuy, taxType: 'sales_tax' })).toBe(false);
    });

    it('reads the connector name tolerantly', () => {
      expect(channelRemitsTheVat({ ...onbuy, channelConnector: ' OnBuy ' })).toBe(true);
    });

    it('does not extend the exception to a channel with no integration', () => {
      expect(channelRemitsTheVat({ ...onbuy, channelConnector: null })).toBe(false);
    });
  });
});

/**
 * The display rule. Every screen was gating on "is there any tax at all", which put "collected by
 * the marketplace — not ours to pay" on an Amazon FR sale's own French VAT: the same money already
 * inside the gross, shown again beneath it under someone else's name.
 */
describe('marketplaceRemitsTax', () => {
  it('is false for our own VAT, which is inside the gross already', () => {
    expect(marketplaceRemitsTax({ taxType: 'vat', vatCollectedByChannel: false })).toBe(false);
  });

  it('is true for VAT the channel reported collecting', () => {
    expect(marketplaceRemitsTax({ taxType: 'vat', vatCollectedByChannel: true })).toBe(true);
  });

  /** Added at checkout on top of our price — never ours, whatever the VAT flag says. */
  it('is true for GST and US sales tax regardless of the VAT flag', () => {
    for (const regime of ['gst', 'sales_tax']) {
      expect(marketplaceRemitsTax({ taxType: regime, vatCollectedByChannel: false })).toBe(true);
    }
  });

  /**
   * Japan is the trap. Amazon collects the consumption tax but the SELLER keeps it — "Your
   * earnings" retains it, which is how the revenue basis already treats it. Lumping JCT in with
   * the other channel-collected taxes would take it out of revenue.
   */
  it('is false for Japanese consumption tax, which the seller keeps', () => {
    expect(marketplaceRemitsTax({ taxType: 'jct', vatCollectedByChannel: false })).toBe(false);
    expect(marketplaceRemitsTax({ taxType: 'jct', vatCollectedByChannel: true })).toBe(false);
  });

  it('treats an absent regime as VAT', () => {
    expect(marketplaceRemitsTax({ taxType: null, vatCollectedByChannel: false })).toBe(false);
    expect(marketplaceRemitsTax({ taxType: undefined, vatCollectedByChannel: true })).toBe(true);
  });

  it('reads the regime tolerantly', () => {
    expect(marketplaceRemitsTax({ taxType: ' SALES_TAX ', vatCollectedByChannel: false })).toBe(true);
  });
});

/**
 * The money fix. `netSalesAmount` is right already — Amazon's VAT report agrees with it on every
 * order checked — so only the tax figure moves.
 */
describe('withoutChannelCollectedTax', () => {
  const lines = [
    { sku: 'A', netSalesAmount: 115.83, vatAmount: 23.17, shippingAmountVat: 0, salesTaxAmount: 23.17 },
    { sku: 'B', netSalesAmount: 10, vatAmount: 2, shippingAmountVat: 0.5, salesTaxAmount: 2.5 },
  ];

  it('zeroes the tax on a VAT sale the channel collected', () => {
    const out = withoutChannelCollectedTax(lines, { taxType: 'vat', vatCollectedByChannel: true });
    expect(out.map((l) => l.vatAmount)).toEqual([0, 0]);
    expect(out.map((l) => l.shippingAmountVat)).toEqual([0, 0]);
  });

  /** Net is not the defect and must not move — it is what revenue is built from. */
  it('leaves net sales and the reported total alone', () => {
    const out = withoutChannelCollectedTax(lines, { taxType: 'vat', vatCollectedByChannel: true });
    expect(out.map((l) => l.netSalesAmount)).toEqual([115.83, 10]);
    expect(out.map((l) => l.salesTaxAmount)).toEqual([23.17, 2.5]);
  });

  it('leaves our own VAT alone when the channel did not collect', () => {
    const out = withoutChannelCollectedTax(lines, { taxType: 'vat', vatCollectedByChannel: false });
    expect(out.map((l) => l.vatAmount)).toEqual([23.17, 2]);
  });

  /**
   * The expensive one. Amazon reports itself facilitator for Japanese consumption tax, but the
   * SELLER keeps it — ¥129,306 on file. Gating on the raw flag instead of the regime would have
   * taken every yen of that out of revenue.
   */
  it('never touches Japanese consumption tax, whatever the flag says', () => {
    const out = withoutChannelCollectedTax(lines, { taxType: 'jct', vatCollectedByChannel: true });
    expect(out.map((l) => l.vatAmount)).toEqual([23.17, 2]);
  });

  /** Added at checkout on top of our price: never ours, whatever the VAT flag says. */
  it('zeroes GST and US sales tax without needing the flag', () => {
    for (const regime of ['gst', 'sales_tax']) {
      const out = withoutChannelCollectedTax(lines, { taxType: regime, vatCollectedByChannel: false });
      expect(out.map((l) => l.vatAmount)).toEqual([0, 0]);
    }
  });

  /**
   * Null is not zero. A line with no tax recorded is a line nobody has answered for, and turning
   * that into a stated zero would claim a fact the channel never gave us.
   */
  it('leaves an unanswered tax field null rather than stating zero', () => {
    const sparse = [{ sku: 'C', netSalesAmount: 5, vatAmount: null, shippingAmountVat: null }];
    expect(withoutChannelCollectedTax(sparse, { taxType: 'vat', vatCollectedByChannel: true }))
      .toEqual([{ sku: 'C', netSalesAmount: 5, vatAmount: null, shippingAmountVat: null }]);
  });

  it('returns a new array and does not mutate the caller’s', () => {
    const out = withoutChannelCollectedTax(lines, { taxType: 'vat', vatCollectedByChannel: true });
    expect(out).not.toBe(lines);
    expect(lines[0].vatAmount).toBe(23.17);
  });

  it('copes with no lines at all', () => {
    expect(withoutChannelCollectedTax([], { taxType: 'vat', vatCollectedByChannel: true })).toEqual([]);
  });
});
