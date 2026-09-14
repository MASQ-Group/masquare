/**
 * What a gather is allowed to do with what it found.
 *
 * The sources themselves live elsewhere and are deliberately dumb: each one goes and looks, and
 * reports what it read, verbatim. Every judgement — may this run at all, does this finding belong to
 * that field, which of three answers is the answer, and may any of it be published — is made here,
 * once, where it can be tested without a network.
 *
 * Three rules the business stated, and one this file adds:
 *
 *   1. Refuse without a manufacturer SKU or an EAN/UPC. There is nothing precise enough to search
 *      on, and a near-match is how a specification from a different variant lands on a listing.
 *   2. The manufacturer is authoritative; anything else needs two sources agreeing.
 *   3. What is not found is left empty. Never assume, never invent, never round up.
 *   4. (here) A person's decision is never overwritten by a machine. The machine may add evidence
 *      beside it — including evidence that contradicts it, which is worth seeing — but the value
 *      stays as the person left it.
 *
 * PURE: every fact is supplied. No fetching, no database, no clock.
 */
import { comparable, groupByMeaning } from './value-match';
import type { AspectBasis, AspectOrigin, AspectRecord, OriginKind } from './provenance';
import { classifyAspect } from './provenance';

/** What the gather needs to know about a product before it will go looking. */
export interface GatherFacts {
  manufacturerSku?: string | null;
  ean?: string | null;
  upc?: string | null;
  brand?: string | null;
  title?: string | null;
}

export type GatherVerdict =
  | { ok: true; searchOn: { mpn: string; gtin: string; gtinKind: 'EAN' | 'UPC'; brand: string | null } }
  | { ok: false; missing: string[]; reason: string };

/**
 * May a gather run for this product?
 *
 * Refusing is the feature. A gather that proceeds on a title alone finds the products that LOOK
 * like this one, and the specification it brings back belongs to a different variant — 1,200 W
 * instead of 900 W, three litres instead of two. That is not a near miss on a listing; it is a
 * wrong claim about a product somebody buys.
 */
export function canGather(facts: GatherFacts): GatherVerdict {
  const mpn = facts.manufacturerSku?.trim() ?? '';
  const ean = facts.ean?.trim() ?? '';
  const upc = facts.upc?.trim() ?? '';

  const missing: string[] = [];
  if (!mpn) missing.push('manufacturer SKU');
  if (!ean && !upc) missing.push('EAN or UPC');

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reason: missing.length === 2
        ? 'This product has neither a manufacturer SKU nor an EAN/UPC. There is nothing precise enough to search on, so the gather would be matching on the title — which finds similar products, not this one.'
        : `This product has no ${missing[0]}. Without it a search matches similar products rather than this one, and their specifications are not this product's.`,
    };
  }

  return {
    ok: true,
    searchOn: {
      mpn,
      gtin: ean || upc,
      gtinKind: ean ? 'EAN' : 'UPC',
      brand: facts.brand?.trim() || null,
    },
  };
}

/** One thing one source said about one field. Verbatim — no cleaning, no unit conversion. */
export interface SourceFinding {
  /** The source's own name for the field: `wattage`, `Power (W)`, `item_weight`. */
  field: string;
  value: string;
  kind: Exclude<OriginKind, 'user'>;
  url?: string;
  label?: string;
}

/**
 * Aspects the product answers itself, which no source is allowed to write.
 *
 * Brand, MPN and Model are already filled from the product every time a listing is built — that is
 * deliberate, so correcting a product's brand corrects its listings rather than leaving the old one
 * frozen in a plan. A gathered value here could only disagree with the product, and the product is
 * right: it is our own record of what we bought.
 *
 * It is also where a mis-identified source does its most visible damage. A lookup that returned
 * somebody else's earphones wrote Brand = Marley onto a Panasonic — caught by `verifyIdentity` now,
 * but these three should never have been in play regardless.
 */
const SELF_ANSWERED = ['brand', 'mpn', 'model'];

/** Priority, and therefore whose spelling of a value is the one stored. */
const RANK: Record<Exclude<OriginKind, 'user'>, number> = { manufacturer: 0, amazon: 1, ebay: 2, web: 3 };

/**
 * A field name reduced to something comparable across sources.
 *
 * Amazon writes `item_weight`, eBay asks for "Item Weight", a datasheet says "Item weight". Casing,
 * spacing and underscores are formatting; `comparable` already folds British and American spelling,
 * so "Colour" and "color" land together too.
 */
function fieldKey(name: string): string {
  return comparable(name).replace(/[^a-z0-9]/g, '');
}

/**
 * The same field, under the names different sources give it.
 *
 * Exact matching alone was throwing nearly everything away, and quietly. eBay's Headphones category
 * asks for "Connectivity", "Type", "Features" and "Earpiece Design"; Amazon answers the same
 * questions as `connectivity_technology`, `headphones_form_factor`, `special_feature` and
 * `included_components`. Not one pair matches on spelling, so a gather that fetched a dozen usable
 * facts stored one — and reported the rest as "no item specific by that name", which read as the
 * source having nothing rather than as us refusing to look it up.
 *
 * A curated list rather than fuzzy matching, and the distinction is the point. Every line here is a
 * decision somebody can read, argue with and correct. Stemming or similarity scoring would silently
 * map "Blade Material" onto "Handle Material" one day and nobody would know which line to change,
 * because there would not be one.
 *
 * Keyed by the eBay-side name. A source field reaching two aspects still attaches to neither.
 */
const ALIASES: Record<string, string[]> = {
  colour: ['colorname', 'basecolour', 'colourfamily', 'colorfamily'],
  material: ['materialcomposition', 'materials', 'materialtype', 'outermaterial'],
  capacity: ['volume', 'itemvolume', 'liquidcapacity', 'capacityvolume', 'tankvolume'],
  wattage: ['power', 'powerconsumption', 'watts', 'inputpower', 'motorpower', 'ratedpower'],
  voltage: ['inputvoltage', 'ratedvoltage', 'operatingvoltage'],
  powersource: ['powersupply', 'powertype', 'powersourcetype'],
  itemweight: ['weight', 'productweight', 'netweight', 'unitweight'],
  itemheight: ['height', 'productheight'],
  itemwidth: ['width', 'productwidth'],
  itemdepth: ['depth', 'productdepth'],
  itemlength: ['length', 'productlength'],
  type: ['producttype', 'itemtypename', 'itemtype', 'subtype'],
  features: ['specialfeature', 'specialfeatures', 'feature', 'keyfeatures'],
  connectivity: ['connectivitytechnology', 'connectiontype', 'interface'],
  numberofitems: ['unitcount', 'itemcount', 'quantity', 'piececount'],
  cordlength: ['cablelength', 'cordlengthmetric'],
  style: ['stylename', 'design'],
  finish: ['finishtype', 'surfacefinish'],
  setincludes: ['includedcomponents', 'includes', 'whatsinthebox', 'boxcontents'],
  careinstructions: ['care', 'cleaninginstructions'],
  countryregionofmanufacture: ['countryoforigin', 'madein'],
  bladematerial: ['bladesmaterial'],
  handlematerial: ['handlesmaterial', 'gripmaterial'],
  dishwashersafe: ['isdishwashersafe'],
  batteriesincluded: ['isbatteriesincluded', 'batteryincluded'],
  batterytype: ['batteriesrequired', 'batterycelltype'],
  earpiecedesign: ['headphonesformfactor', 'formfactor', 'wearingstyle'],
  capacityweight: ['maximumweight', 'maxload'],
  speed: ['speeds', 'numberofspeeds', 'speedsettings'],
};

/**
 * Which aspect does this finding answer, if any?
 *
 * Exact on the reduced name, then the alias list, then nothing. A source field that reaches two
 * aspects answers neither — the same discipline SKU matching uses, and for the same reason: a
 * confident wrong attachment is more expensive than an obvious gap. Still nothing here does
 * prefixes, stems or similarity; an unlisted name is reported unmatched, not guessed at.
 */
export function matchFieldToAspect(field: string, aspectNames: readonly string[]): string | null {
  const key = fieldKey(field);
  if (!key) return null;

  const exact = aspectNames.filter((n) => fieldKey(n) === key);
  if (exact.length > 0) return exact.length === 1 ? exact[0] : null;

  const aliased = aspectNames.filter((n) => (ALIASES[fieldKey(n)] ?? []).includes(key));
  return aliased.length === 1 ? aliased[0] : null;
}

export interface FoldResult {
  records: Record<string, AspectRecord>;
  /** Found, but not used — with the reason, so a gap on screen is explainable rather than a shrug. */
  ignored: Array<{ field: string; value: string; why: string }>;
  /** What the gather did to each aspect it reached. */
  touched: Array<{ name: string; value: string; basis: AspectBasis; changed: boolean }>;
}

/**
 * Fold everything the sources reported into the stored answers.
 *
 * Every finding becomes an origin, including the losing ones: the disagreement IS the evidence, and
 * a record that kept only the winner would present a contested value as a settled one.
 *
 * Which value wins is decided by rank, not by counting. The manufacturer wins outright; failing
 * that, the one value two different sources agree on; failing that, the best-ranked source's value —
 * stored, but classified as a suggestion and withheld until a person confirms it.
 */
export function foldFindings(
  existing: Readonly<Record<string, AspectRecord>>,
  findings: readonly SourceFinding[],
  aspectNames: readonly string[],
  at: string,
): FoldResult {
  const records: Record<string, AspectRecord> = { ...existing };
  const ignored: FoldResult['ignored'] = [];
  const touched: FoldResult['touched'] = [];

  /** Group the findings by the aspect they answer, dropping the ones that answer nothing. */
  const byAspect = new Map<string, SourceFinding[]>();
  for (const f of findings) {
    const value = f.value?.trim() ?? '';
    if (!value) continue; // Nothing found is not a finding. It is left empty, as instructed.

    const name = matchFieldToAspect(f.field, aspectNames);
    if (!name) {
      ignored.push({ field: f.field, value, why: 'this category has no item specific by that name' });
      continue;
    }
    if (SELF_ANSWERED.includes(fieldKey(name))) {
      ignored.push({ field: f.field, value, why: 'answered from the product itself, which is more reliable here than a marketplace' });
      continue;
    }
    const list = byAspect.get(name) ?? [];
    list.push({ ...f, value });
    byAspect.set(name, list);
  }

  for (const [name, found] of byAspect) {
    const ranked = [...found].sort((a, b) => RANK[a.kind] - RANK[b.kind]);
    const prior = existing[name];
    const settled = !!prior && (prior.verifiedAt != null || prior.origins.some((o) => o.kind === 'user'));

    const origins = mergeOrigins(prior?.origins ?? [], ranked.map((f) => asOrigin(f, at)));

    /**
     * A person already decided this one. The evidence is filed beside their answer — so a datasheet
     * that disagrees is visible next time somebody looks — but the value is theirs and stays.
     */
    if (settled) {
      const rec: AspectRecord = { ...prior, origins };
      records[name] = rec;
      touched.push({ name, value: rec.value, basis: classifyAspect(rec), changed: false });
      continue;
    }

    const groups = groupByMeaning(ranked, (f) => f.value);
    const authoritative = groups.filter((g) => g.items.some((i) => i.kind === 'manufacturer'));
    const corroborated = groups.filter((g) => new Set(g.items.map((i) => i.kind)).size >= 2);

    /**
     * Rank first, agreement second, best-available last. The last case is the one that produces a
     * suggestion rather than an answer — deliberately stored, because a value a person can accept
     * in one click is worth more than a blank, and deliberately withheld, because one marketplace
     * saying so is not the standard this business set.
     */
    const winner = authoritative[0] ?? corroborated[0] ?? groups[0];
    if (!winner) continue;

    const rec: AspectRecord = { value: winner.value, origins };
    records[name] = rec;
    touched.push({
      name,
      value: rec.value,
      basis: classifyAspect(rec),
      changed: !prior || prior.value !== rec.value,
    });
  }

  return { records, ignored, touched };
}

function asOrigin(f: SourceFinding, at: string): AspectOrigin {
  return {
    kind: f.kind,
    value: f.value,
    ...(f.url ? { url: f.url } : {}),
    ...(f.label ? { label: f.label } : {}),
    at,
  };
}

/**
 * Add what is new without stacking what is not.
 *
 * A gather run twice should not leave two identical Amazon origins behind — the second says nothing
 * the first did not, and a doubled origin makes a value look better attested than it is. Identity
 * is the source and what it said, so the same source CHANGING its mind is kept: that is news.
 */
function mergeOrigins(prior: readonly AspectOrigin[], incoming: readonly AspectOrigin[]): AspectOrigin[] {
  const out = [...prior];
  for (const o of incoming) {
    const dup = out.some((e) => e.kind === o.kind && comparable(e.value) === comparable(o.value));
    if (!dup) out.push(o);
  }
  return out;
}
