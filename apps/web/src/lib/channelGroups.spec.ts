import { describe, expect, it } from 'vitest';
import {
  CHANNEL_GROUPS,
  channelGroupOf,
  channelPlatform,
  channelSortIndex,
  sortByChannelCanonical,
  sortChannelsCanonical,
} from './channelGroups';

/**
 * The order channels are shown in, everywhere.
 *
 * This is a decision, not a derivation — nothing about the data implies Amazon AU should come
 * before Amazon AE — so it is written down here as the sequence that was asked for. If a change to
 * the groups moves a marketplace, this test says so before a screen does.
 */
const asked = [
  'Amazon Europe',
  'Amazon Americas',
  'Amazon Australia',
  'Amazon UAE',
  'Amazon Saudi Arabia',
  'Amazon Japan',
  'Amazon Singapore',
  'eBay Europe',
  'eBay Americas',
  'eBay Australia',
  'OnBuy',
];

const ch = (name: string, countryIso: string | null, channelType?: string) => ({ name, countryIso, channelType });

describe('the canonical channel sequence', () => {
  it('is exactly the order that was specified', () => {
    expect(CHANNEL_GROUPS.map((g) => g.label)).toEqual(asked);
  });

  it('puts a real set of channels in that order', () => {
    // Deliberately fed in scrambled: alphabetical by name is what the API returns, and it is the
    // order this exists to override.
    const scrambled = [
      ch('OnBuy UK', 'GB', 'onbuy'),
      ch('Amazon SA', 'SA', 'amazon'),
      ch('eBay US', 'US', 'ebay'),
      ch('Amazon JP', 'JP', 'amazon'),
      ch('Amazon DE', 'DE', 'amazon'),
      ch('Amazon AU', 'AU', 'amazon'),
      ch('eBay UK', 'GB', 'ebay'),
      ch('Amazon US', 'US', 'amazon'),
      ch('Amazon AE', 'AE', 'amazon'),
      ch('Amazon SG', 'SG', 'amazon'),
      ch('eBay AU', 'AU', 'ebay'),
      ch('Amazon UK', 'GB', 'amazon'),
    ];
    expect(sortChannelsCanonical(scrambled).map((c) => c.name)).toEqual([
      'Amazon UK', 'Amazon DE',
      'Amazon US',
      'Amazon AU', 'Amazon AE', 'Amazon SA', 'Amazon JP', 'Amazon SG',
      'eBay UK', 'eBay US', 'eBay AU',
      'OnBuy UK',
    ]);
  });

  it('keeps every Amazon marketplace ahead of every eBay one', () => {
    // The property behind the list: platforms do not interleave, whatever the countries.
    const amazon = CHANNEL_GROUPS.filter((g) => g.platform === 'amazon');
    const ebay = CHANNEL_GROUPS.filter((g) => g.platform === 'ebay');
    const lastAmazon = Math.max(...amazon.map((g) => CHANNEL_GROUPS.indexOf(g)));
    const firstEbay = Math.min(...ebay.map((g) => CHANNEL_GROUPS.indexOf(g)));
    expect(lastAmazon).toBeLessThan(firstEbay);
  });

  it('gives each standalone Amazon account its own place', () => {
    // AU, AE, SA, JP and SG are separate seller accounts, not members of a region. Grouping them
    // as "APAC" and "MENA" produced an order nobody had asked for.
    for (const iso of ['AU', 'AE', 'SA', 'JP', 'SG']) {
      const group = channelGroupOf(ch(`Amazon ${iso}`, iso, 'amazon'));
      expect(group?.isos, iso).toEqual([iso]);
    }
  });
});

describe('placing a channel in the sequence', () => {
  it('reads UK as GB, because the marketplaces call it UK and ISO does not', () => {
    // Our largest marketplace. Left unmapped it fails every lookup and sinks to the bottom of
    // every list on the platform.
    expect(channelSortIndex(ch('Amazon UK', 'UK', 'amazon'))).toBe(channelSortIndex(ch('Amazon UK', 'GB', 'amazon')));
    expect(channelSortIndex(ch('Amazon UK', 'UK', 'amazon'))).toBe(0);
  });

  it('trusts the channel type over the display name', () => {
    // A channel renamed to something meaningful for the company would otherwise become 'other'
    // and sort last, silently.
    expect(channelPlatform(ch('MASQ Marketplace DE', 'DE', 'amazon'))).toBe('amazon');
    expect(channelSortIndex(ch('MASQ Marketplace DE', 'DE', 'amazon'))).toBe(
      channelSortIndex(ch('Amazon DE', 'DE', 'amazon')),
    );
  });

  it('still reads the platform from the name when no type is given', () => {
    expect(channelPlatform(ch('Amazon DE', 'DE'))).toBe('amazon');
    expect(channelPlatform('eBay UK')).toBe('ebay');
  });

  it('sends anything unrecognised to the end rather than into the middle', () => {
    // An unplaced channel landing mid-sequence is a bug nobody would notice.
    const sorted = sortChannelsCanonical([ch('Etsy UK', 'GB', 'etsy'), ch('Amazon DE', 'DE', 'amazon')]);
    expect(sorted.map((c) => c.name)).toEqual(['Amazon DE', 'Etsy UK']);
  });

  it('places OnBuy even with no country at all', () => {
    // OnBuy has exactly one marketplace, so the country adds nothing and its absence must not
    // unplace the channel.
    expect(channelSortIndex(ch('OnBuy', null, 'onbuy'))).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('is stable for two channels sharing a position', () => {
    const sorted = sortChannelsCanonical([ch('Amazon DE b', 'DE', 'amazon'), ch('Amazon DE a', 'DE', 'amazon')]);
    expect(sorted.map((c) => c.name)).toEqual(['Amazon DE a', 'Amazon DE b']);
  });
});

describe('sorting things that merely reference a channel', () => {
  it('orders preview rows the same way as the channels themselves', () => {
    // A list-everywhere row is not a channel but is read beside the cards, so it must not use a
    // second order of its own.
    const rows = [
      { marketplace: 'JP', name: 'Amazon JP' },
      { marketplace: 'DE', name: 'Amazon DE' },
      { marketplace: 'AU', name: 'Amazon AU' },
    ];
    const sorted = sortByChannelCanonical(rows, (r) => ({ name: r.name, countryIso: r.marketplace, channelType: 'amazon' }));
    expect(sorted.map((r) => r.marketplace)).toEqual(['DE', 'AU', 'JP']);
  });
});
