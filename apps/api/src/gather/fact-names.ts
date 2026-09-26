/**
 * One name for a fact, whatever a marketplace calls it.
 *
 * The same fact about the same product is stored twice today: eBay keeps `Colour` in the plan's
 * `aspects`, OnBuy keeps `Colour` — or `Color`, or `General Product Information › Colour` — in the
 * plan's `specifics`. Both were researched separately, and neither can see the other's answer. Every
 * channel added since has made a third copy, and Jinius and Shopify would make a fifth and sixth.
 *
 * So a fact gets a canonical name, and each channel asks for it by whatever IT calls the thing. The
 * vocabulary is deliberately small: a normalisation that removes the ways a name can differ without
 * meaning anything different, and a short list of genuine synonyms. A name nobody has taught it
 * passes through as itself, so an unknown field behaves exactly as it does today rather than being
 * mapped to something it is not.
 *
 * PURE.
 */

/**
 * Names for the same thing, in the spellings marketplaces actually use.
 *
 * Only pairs that are unambiguously the same fact. `Capacity` and `Volume` are NOT here: a kettle's
 * capacity is its volume, a battery's capacity is not, and a mapping that is right most of the time
 * is the kind that puts a wrong figure on a listing without anybody noticing.
 */
const SYNONYMS: Record<string, string> = {
  color: 'colour',
  colours: 'colour',
  colors: 'colour',
  'main colour': 'colour',
  'primary colour': 'colour',
  manufacturer: 'brand',
  'brand name': 'brand',
  'manufacturer part number': 'mpn',
  'part number': 'mpn',
  'model number': 'mpn',
  'mpn / part number': 'mpn',
  ean: 'ean',
  'ean code': 'ean',
  barcode: 'ean',
  gtin: 'ean',
  'item weight': 'weight',
  'product weight': 'weight',
  'net weight': 'weight',
  wattage: 'power',
  'power consumption': 'power',
  'rated power': 'power',
  'material type': 'material',
  'manufacturer warranty': 'warranty',
  'warranty period': 'warranty',
  'country of origin': 'country of manufacture',
};

/**
 * The name with everything that does not change its meaning taken off.
 *
 * A channel may qualify a field with the group it sits in ("General Product Information › Colour"),
 * punctuate it differently, or simply capitalise it another way. None of those make it a different
 * fact, and treating them as different is how the same answer came to be researched twice.
 */
export function canonicalFactName(raw: string | null | undefined): string {
  const afterGroup = String(raw ?? '').split(/›|›|\|/).pop() ?? '';
  const tidy = afterGroup
    .trim()
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, ' ')   // a parenthetical qualifier: "Weight (kg)"
    .replace(/[_/\\-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!tidy) return '';
  return SYNONYMS[tidy] ?? tidy;
}

/** Whether two names, however each channel spells them, are the same fact. */
export const sameFact = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = canonicalFactName(a);
  return !!x && x === canonicalFactName(b);
};

/**
 * Find what we hold for a field, by the name the CHANNEL uses.
 *
 * Exact first, always: a store that already holds the channel's own spelling is answering about
 * itself and must not be reinterpreted. The canonical pass runs only on a miss, so widening the
 * rule cannot change an answer that already existed — the same property that made the SKU matcher
 * safe to turn on across seventeen thousand rows.
 */
export function factFor<T>(store: Readonly<Record<string, T>>, channelName: string): T | undefined {
  const exact = store[channelName];
  if (exact !== undefined) return exact;
  const wanted = canonicalFactName(channelName);
  if (!wanted) return undefined;
  for (const [name, value] of Object.entries(store)) {
    if (canonicalFactName(name) === wanted) return value;
  }
  return undefined;
}

/**
 * Every fact keyed canonically, with the channel spellings that produced each.
 *
 * Two channel names that fold to one fact keep the FIRST answer rather than the last: the order the
 * callers are merged in is the order of trust they were passed in, and silently preferring whichever
 * happened to be iterated last would make the result depend on nothing anybody chose.
 */
export function byCanonicalName<T>(store: Readonly<Record<string, T>>): Map<string, { name: string; value: T }> {
  const out = new Map<string, { name: string; value: T }>();
  for (const [name, value] of Object.entries(store)) {
    const key = canonicalFactName(name);
    if (!key || out.has(key)) continue;
    out.set(key, { name, value });
  }
  return out;
}
