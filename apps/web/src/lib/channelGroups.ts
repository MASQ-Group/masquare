// Canonical sales-channel groupings + ordering, shared across the platform.
//
// A channel is identified by its selling platform (Amazon / eBay / OnBuy) and its marketplace
// country (ISO-2, e.g. GB, US, AE). Note: Amazon/eBay UK map to ISO "GB", and Australia is "AU".
//
// The order of CHANNEL_GROUPS below IS the canonical display sequence, everywhere channels are
// listed — columns, cards, pickers, dropdowns. The order of `isos` within a group is the canonical
// order inside it. Change it here and every screen follows; there is deliberately nowhere else to
// change it.
//
// The grouping follows the seller accounts rather than geography. Amazon AU, AE, SA, JP and SG are
// each a separate account with its own registration, and a SKU is unique within one account —
// which is why "Amazon APAC" was a grouping that described nothing anyone actually works with.

export type ChannelGroupKey =
  | 'amazon-eu'
  | 'amazon-americas'
  | 'amazon-au'
  | 'amazon-ae'
  | 'amazon-sa'
  | 'amazon-jp'
  | 'amazon-sg'
  | 'ebay-eu'
  | 'ebay-americas'
  | 'ebay-au'
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
  { key: 'amazon-au', label: 'Amazon Australia', platform: 'amazon', isos: ['AU'] },
  { key: 'amazon-ae', label: 'Amazon UAE', platform: 'amazon', isos: ['AE'] },
  { key: 'amazon-sa', label: 'Amazon Saudi Arabia', platform: 'amazon', isos: ['SA'] },
  { key: 'amazon-jp', label: 'Amazon Japan', platform: 'amazon', isos: ['JP'] },
  { key: 'amazon-sg', label: 'Amazon Singapore', platform: 'amazon', isos: ['SG'] },
  { key: 'ebay-eu', label: 'eBay Europe', platform: 'ebay', isos: ['GB', 'DE', 'FR', 'ES', 'IT'] },
  { key: 'ebay-americas', label: 'eBay Americas', platform: 'ebay', isos: ['US', 'CA'] },
  { key: 'ebay-au', label: 'eBay Australia', platform: 'ebay', isos: ['AU'] },
  { key: 'onbuy', label: 'OnBuy', platform: 'onbuy', isos: ['GB'] },
];

/**
 * Anything that carries a marketplace country and some way of telling which platform it is.
 *
 * `channelType` is the integration's own field and is preferred when present; the name is only a
 * fallback. Reading the platform out of a display name works until somebody renames a channel to
 * something sensible for their own company, at which point it silently becomes 'other' and sorts to
 * the bottom of every list on the platform.
 */
export interface ChannelLike {
  name: string;
  countryIso?: string | null;
  /** 'amazon' | 'ebay' | 'onbuy' — the connector key, when the caller has it. */
  channelType?: string | null;
}

export function channelPlatform(nameOrChannel: string | ChannelLike): ChannelPlatform {
  const explicit = typeof nameOrChannel === 'string' ? null : nameOrChannel.channelType;
  const candidate = (explicit ?? (typeof nameOrChannel === 'string' ? nameOrChannel : nameOrChannel.name) ?? '').toLowerCase();
  if (candidate.includes('amazon')) return 'amazon';
  if (candidate.includes('ebay')) return 'ebay';
  if (candidate.includes('onbuy')) return 'onbuy';
  return 'other';
}

/**
 * Marketplace codes that are not their ISO country code.
 *
 * Amazon and eBay both call the United Kingdom "UK"; ISO-3166 calls it GB, and the groups above are
 * keyed by ISO. A caller that has only the marketplace code would otherwise fail every lookup for
 * our largest marketplace and sort it to the very bottom of every list.
 */
const ISO_ALIASES: Record<string, string> = { UK: 'GB', EL: 'GR' };
const normaliseIso = (raw: string | null | undefined): string => {
  const iso = (raw ?? '').trim().toUpperCase();
  return ISO_ALIASES[iso] ?? iso;
};

// Flat canonical order of `${platform}:${iso}` keys, so a channel's position is one index lookup.
const ORDER: string[] = [];
CHANNEL_GROUPS.forEach((g) => g.isos.forEach((iso) => ORDER.push(`${g.platform}:${iso}`)));

// When a platform has exactly one group (e.g. OnBuy = UK only), any channel of that platform
// belongs to it even if its country is missing or unrecognised.
function soleGroupForPlatform(platform: ChannelPlatform): ChannelGroup | undefined {
  const gs = CHANNEL_GROUPS.filter((g) => g.platform === platform);
  return gs.length === 1 ? gs[0] : undefined;
}

export function channelGroupOf(ch: ChannelLike): ChannelGroup | undefined {
  const platform = channelPlatform(ch);
  const iso = normaliseIso(ch.countryIso);
  return CHANNEL_GROUPS.find((g) => g.platform === platform && g.isos.includes(iso)) ?? soleGroupForPlatform(platform);
}

export function channelSortIndex(ch: ChannelLike): number {
  const platform = channelPlatform(ch);
  const iso = normaliseIso(ch.countryIso);
  let i = ORDER.indexOf(`${platform}:${iso}`);
  if (i === -1) {
    const sole = soleGroupForPlatform(platform);
    if (sole) i = ORDER.indexOf(`${sole.platform}:${sole.isos[0]}`);
  }
  // A channel we do not recognise sorts after every one we do, rather than silently landing in the
  // middle of the sequence where nobody would notice it was unplaced.
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Sort a list of channels into the canonical sequence. The one function every list should use. */
export function sortChannelsCanonical<T extends ChannelLike>(channels: T[]): T[] {
  return [...channels].sort((a, b) => {
    const d = channelSortIndex(a) - channelSortIndex(b);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}

/**
 * Sort things that reference a channel without being one — a preview row, a result line.
 *
 * Same order, reached through whatever the caller can supply. Saves every such list from
 * reinventing the mapping and drifting from the sequence above.
 */
export function sortByChannelCanonical<T>(items: T[], toChannel: (item: T) => ChannelLike): T[] {
  return [...items].sort((a, b) => {
    const d = channelSortIndex(toChannel(a)) - channelSortIndex(toChannel(b));
    return d !== 0 ? d : toChannel(a).name.localeCompare(toChannel(b).name);
  });
}

/**
 * A sales channel, in the shape the canonical sort understands.
 *
 * Sales channels are a different record from channel integrations — they carry no connector key and
 * no marketplace code, only a name and the country they trade in. That country is the one reliable
 * part: every marketplace channel has it, and it is correct where the name is not. "Amazon JPN" and
 * "Ebay AUS" would both defeat a name parser; their native countries are plainly JP and AU.
 *
 * So the country comes from the record and only the platform is read from the name. Channels that
 * are not marketplaces at all — our own local sales, retail — resolve to 'other' and sort after
 * every marketplace, alphabetically among themselves, which is where they belong in a picker.
 */
export function salesChannelAsChannel(sc: {
  name: string;
  nativeCountry?: { isoCode: string } | null;
  nativeCountryIso?: string | null;
}): ChannelLike {
  return { name: sc.name, countryIso: sc.nativeCountry?.isoCode ?? sc.nativeCountryIso ?? null };
}
