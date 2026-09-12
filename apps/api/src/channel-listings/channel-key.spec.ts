import { describe, expect, it } from 'vitest';
import { channelKey } from './channel-key';

describe('channelKey', () => {
  /** Amazon and OnBuy connect once per marketplace, and their listings store an empty marketplace. */
  it('is the integration id alone where one connection means one channel', () => {
    expect(channelKey({ integrationId: 'amz-uk', marketplace: '' })).toBe('amz-uk');
    expect(channelKey({ integrationId: 'amz-uk' })).toBe('amz-uk');
    expect(channelKey({ integrationId: 'amz-uk', marketplace: null })).toBe('amz-uk');
  });

  /** eBay sells on many marketplaces through one token, so the marketplace splits it. */
  it('splits one connection into a channel per marketplace', () => {
    expect(channelKey({ integrationId: 'ebay', marketplace: 'GB' })).toBe('ebay:GB');
    expect(channelKey({ integrationId: 'ebay', marketplace: 'DE' })).toBe('ebay:DE');
    expect(channelKey({ integrationId: 'ebay', marketplace: 'GB' }))
      .not.toBe(channelKey({ integrationId: 'ebay', marketplace: 'DE' }));
  });

  /**
   * Whitespace around a marketplace must not mint a second channel. A key that differs by a space
   * would put the same listing in a column nothing else looks at, and read as "not listed here".
   */
  it('does not let stray whitespace invent a channel', () => {
    expect(channelKey({ integrationId: 'ebay', marketplace: ' GB ' })).toBe('ebay:GB');
    expect(channelKey({ integrationId: 'amz', marketplace: '   ' })).toBe('amz');
  });

  /**
   * Two integrations are two channels even on the same marketplace — the same marketplace sold
   * through two seller accounts is two places a product can be listed, and both companies' rows
   * are visible to someone who may see both.
   */
  it('keeps two seller accounts on one marketplace apart', () => {
    expect(channelKey({ integrationId: 'ebay-a', marketplace: 'GB' }))
      .not.toBe(channelKey({ integrationId: 'ebay-b', marketplace: 'GB' }));
  });
});
