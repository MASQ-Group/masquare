// Canonical sales-channel groupings + ordering, shared across the platform.
//
// A channel is identified by its selling platform (Amazon / eBay / OnBuy — derived
// from the channel name) and its marketplace country (ISO-2, e.g. GB, US, AE).
// Note: Amazon/eBay UK map to ISO "GB", and Australia is "AU".
//
// The order of CHANNEL_GROUPS below is the canonical column/display sequence, and the
// order of `isos` within each group is the canonical order of channels inside a group.

export type ChannelGroupKey =
  | 'amazon-eu'
  | 'amazon-americas'
  | 'amazon-apac'
  | 'amazon-mena'
  | 'ebay-eu'
  | 'ebay-americas'
  | 'ebay-apac'
  | 'onbuy';

export type ChannelPlatform = 'amazon' | 'ebay' | 'onbuy' | 'other';

export interface ChannelGroup {
  key: ChannelGroupKey;
  label: string;
  platform: ChannelPlatform;
  /** Marketplace countries in this group, in canonical order (ISO-2). */
  isos: string[];
}

export const CHANNEL_GROUPS: ChannelGroup[] = [
  { key: 'amazon-eu', label: 'Amazon Europe', platform: 'amazon', isos: ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'SE', 'PL', 'IE'] },
  { key: 'amazon-americas', label: 'Amazon Americas', platform: 'amazon', isos: ['US', 'CA', 'MX'] },
  { key: 'amazon-apac', label: 'Amazon Asia-Pacific', platform: 'amazon', isos: ['JP', 'AU', 'SG'] },
  { key: 'amazon-mena', label: 'Amazon Middle East & North Africa', platform: 'amazon', isos: ['AE', 'SA'] },
  { key: 'ebay-eu', label: 'eBay Europe', platform: 'ebay', isos: ['GB', 'DE', 'FR', 'ES', 'IT'] },
  { key: 'ebay-americas', label: 'eBay Americas', platform: 'ebay', isos: ['US', 'CA'] },
  { key: 'ebay-apac', label: 'eBay Asia-Pacific', platform: 'ebay', isos: ['AU'] },
  { key: 'onbuy', label: 'OnBuy', platform: 'onbuy', isos: ['GB'] },
];

/** Anything that carries a channel name and a marketplace country ISO. */
export interface ChannelLike {
  name: string;
  countryIso?: string | null;
}

export function channelPlatform(name: string): ChannelPlatform {
  const n = (name ?? '').toLowerCase();
  if (n.includes('amazon')) return 'amazon';
  if (n.includes('ebay')) return 'ebay';
  if (n.includes('onbuy')) return 'onbuy';
  return 'other';
}

// Flat canonical order of `${platform}:${iso}` keys, so a channel's column position
// is a single index lookup.
const ORDER: string[] = [];
CHANNEL_GROUPS.forEach((g) => g.isos.forEach((iso) => ORDER.push(`${g.platform}:${iso}`)));

export function channelGroupOf(ch: ChannelLike): ChannelGroup | undefined {
  const platform = channelPlatform(ch.name);
  const iso = (ch.countryIso ?? '').toUpperCase();
  return CHANNEL_GROUPS.find((g) => g.platform === platform && g.isos.includes(iso));
}

export function channelSortIndex(ch: ChannelLike): number {
  const platform = channelPlatform(ch.name);
  const iso = (ch.countryIso ?? '').toUpperCase();
  const i = ORDER.indexOf(`${platform}:${iso}`);
  // Unknown channels sort after all known ones, alphabetically by name via the caller.
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Sort a list of channels into the canonical group/column sequence. */
export function sortChannelsCanonical<T extends ChannelLike>(channels: T[]): T[] {
  return [...channels].sort((a, b) => {
    const d = channelSortIndex(a) - channelSortIndex(b);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}
