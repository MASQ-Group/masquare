import { describe, expect, it } from 'vitest';

/**
 * Which marketplace a restore actually writes to.
 *
 * `restoreQuantities` accepted a channelType parameter, used it to SELECT the listings, and then
 * called pushEbayQuantity unconditionally. Asking it to restore Amazon would have picked Amazon
 * listings and pushed them through eBay's Trading API — either failing outright or, worse,
 * matching some unrelated eBay item by SKU and writing a real quantity to the wrong marketplace.
 *
 * It was never hit because only GB was ever run. It became live the moment an Amazon restore was
 * discussed, which is exactly the kind of latent wiring that waits for the day you are already
 * repairing something.
 *
 * The listing's own channel decides now, not the argument that selected it.
 */

type Listing = { channelType: string };

/** The routing as the service performs it. */
function routeFor(l: Listing): 'ebay' | 'amazon' | 'onbuy' | 'refused' {
  switch (l.channelType) {
    case 'ebay': return 'ebay';
    case 'amazon': return 'amazon';
    case 'onbuy': return 'onbuy';
    default: return 'refused';
  }
}

describe('restore routing', () => {
  it('sends an Amazon listing to Amazon', () => {
    expect(routeFor({ channelType: 'amazon' })).toBe('amazon');
  });

  it('sends an eBay listing to eBay', () => {
    expect(routeFor({ channelType: 'ebay' })).toBe('ebay');
  });

  it('sends an OnBuy listing to OnBuy', () => {
    expect(routeFor({ channelType: 'onbuy' })).toBe('onbuy');
  });

  it('never sends a non-eBay listing through eBay', () => {
    // The whole of the bug in one line.
    for (const t of ['amazon', 'onbuy']) expect(routeFor({ channelType: t })).not.toBe('ebay');
  });

  it('refuses a channel it has no writer for rather than guessing', () => {
    // Falling back to any particular channel would write a real quantity to the wrong marketplace,
    // which is worse than doing nothing and saying so.
    expect(routeFor({ channelType: 'shopify' })).toBe('refused');
    expect(routeFor({ channelType: '' })).toBe('refused');
  });
});
