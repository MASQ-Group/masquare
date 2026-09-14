/**
 * Where an item specific came from, and whether that is enough to put it on a listing.
 *
 * The rule this encodes is the one the business stated: the manufacturer's own page or datasheet is
 * authoritative, and anything that cannot be found there is acceptable only when two sources agree
 * on it. Amazon and eBay are useful and frequently wrong, so neither is ever trusted alone.
 *
 * That rule is worth nothing if it only lives in the gather. A value written by a gather that was
 * right in March is indistinguishable, six months later, from one somebody typed — unless the value
 * carries its own evidence. So every answer keeps the list of sources that vouched for it, with what
 * each ACTUALLY SAID, and the trust level is derived from that list on every read rather than
 * stamped once and believed forever.
 *
 * The consequence with teeth: a value only one non-authoritative source vouches for is stored,
 * shown, and WITHHELD from eBay until a person confirms it. It is a suggestion, not an answer.
 *
 * PURE: every fact is supplied. No fetching, no database, no clock — `at` is always passed in.
 */
import { comparable } from './value-match';

/**
 * Amazon and eBay are peers; `web` (any other page found by searching) is a peer of both;
 * `manufacturer` outranks all three; `user` outranks everything.
 */
export type OriginKind = 'user' | 'manufacturer' | 'amazon' | 'ebay' | 'web';

export interface AspectOrigin {
  kind: OriginKind;
  /**
   * What THIS source said — not what was concluded. Kept per-origin so a disagreement stays visible
   * instead of being resolved silently into one value nobody can audit.
   */
  value: string;
  /** Where to go and check: a datasheet PDF, a product page, a listing. */
  url?: string;
  /** Human-readable provenance, e.g. "Beurer datasheet (PDF, p.4)". */
  label?: string;
  /** ISO-8601, supplied by the caller. */
  at?: string;
}

export interface AspectRecord {
  value: string;
  origins: AspectOrigin[];
  /** Set when a person read the evidence and accepted it. Promotes a held-back value. */
  verifiedAt?: string;
  verifiedBy?: string;
}

/**
 * - `user` — a person typed or confirmed it.
 * - `authoritative` — the manufacturer says so.
 * - `agreement` — two or more independent sources say the same thing.
 * - `unconfirmed` — exactly one non-authoritative source says so. A suggestion; held back.
 * - `conflict` — sources disagree and nothing outranks the argument. Held back.
 */
export type AspectBasis = 'user' | 'authoritative' | 'agreement' | 'unconfirmed' | 'conflict';

/**
 * Do two sources say the same thing?
 *
 * Borrowed from `value-match` rather than re-implemented, and that is the entire point. This module
 * decides whether two sources AGREE; the gather decides the same thing when it folds findings
 * together. Two definitions would drift, and the drift would be silent: Amazon writing "1200 W" and
 * eBay writing "1200 watts" would fold as agreement and then classify as a conflict, so a value both
 * sources vouch for would be withheld for no reason anybody could see.
 */
const same = (a: string, b: string) => comparable(a) === comparable(b);

/**
 * What counts as ONE source, when asking whether two of them agree.
 *
 * For the named sources the kind IS the source: two Amazon pages are Amazon twice, and letting them
 * corroborate each other would clear the two-source bar on one opinion. Two pages from the maker are
 * likewise the maker.
 *
 * `web` is the exception, because it is not a place — it is everywhere else. A distributor and a
 * review site are genuinely independent, so they are told apart by host. Without this, every page a
 * search turned up would collapse into one voice and nothing found on the open web could ever
 * corroborate anything.
 */
function sourceIdentity(o: AspectOrigin): string {
  if (o.kind !== 'web') return o.kind;
  try {
    return `web:${new URL(o.url ?? '').hostname.toLowerCase().replace(/^www\./, '')}`;
  } catch {
    // A web origin with no usable URL cannot be told apart from another, so they count as one.
    return 'web:unknown';
  }
}

/**
 * Derive the trust level from the evidence, on every read.
 *
 * The order is the business rule in sequence: a person's decision beats everything, the manufacturer
 * beats the marketplaces, and the marketplaces count only when they corroborate each other. Two
 * Amazon pages are not two sources, so kinds are counted distinctly rather than origins.
 */
export function classifyAspect(rec: AspectRecord): AspectBasis {
  const backing = rec.origins.filter((o) => same(o.value, rec.value));
  const dissent = rec.origins.filter((o) => !same(o.value, rec.value));

  if (backing.some((o) => o.kind === 'user')) return 'user';
  /**
   * A marketplace disagreeing with the manufacturer loses, which is the whole point of the ranking.
   * Another MANUFACTURER source disagreeing is a different thing entirely — a datasheet against a
   * product page — and there is nothing left to break the tie, so it goes to a person.
   */
  if (backing.some((o) => o.kind === 'manufacturer')) {
    return dissent.some((o) => o.kind === 'manufacturer') ? 'conflict' : 'authoritative';
  }

  const corroborating = new Set(backing.map(sourceIdentity));
  /**
   * Nothing vouches for the stored value. An empty origin list is a value written before any of this
   * existed, which could only have been typed; anything else means the evidence argues with what is
   * stored, and a person has to settle it.
   */
  if (corroborating.size === 0) return rec.origins.length === 0 ? 'user' : 'conflict';
  if (corroborating.size >= 2) return 'agreement';
  return dissent.length > 0 ? 'conflict' : 'unconfirmed';
}

/**
 * May this travel to eBay?
 *
 * A suggestion from one marketplace is not an answer — but a person who has read the evidence and
 * accepted it has made it one, which is what `verifiedAt` records.
 */
export function isPayloadEligible(rec: AspectRecord): boolean {
  if (rec.verifiedAt) return true;
  const basis = classifyAspect(rec);
  return basis === 'user' || basis === 'authoritative' || basis === 'agreement';
}

/**
 * Read the stored column, whatever shape it is in.
 *
 * `aspects` held a flat name-to-string map before provenance existed, and rows in that shape are
 * still the majority. Rather than migrate them — which would mean inventing evidence for values
 * whose evidence was never recorded — both shapes are read here, and a bare string is taken for what
 * it truthfully is: something a person typed.
 *
 * Anything unrecognisable is dropped rather than guessed at. A malformed aspect that quietly became
 * an empty string would be published as an empty string.
 */
export function normaliseAspects(raw: unknown): Record<string, AspectRecord> {
  const out: Record<string, AspectRecord> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') {
      const value = v.trim();
      if (value) out[name] = { value, origins: [{ kind: 'user', value }] };
      continue;
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;

    const rec = v as Record<string, unknown>;
    const value = typeof rec.value === 'string' ? rec.value.trim() : '';
    if (!value) continue;

    const origins: AspectOrigin[] = Array.isArray(rec.origins)
      ? rec.origins.flatMap((o): AspectOrigin[] => {
        if (!o || typeof o !== 'object') return [];
        const src = o as Record<string, unknown>;
        const kind = src.kind;
        if (kind !== 'user' && kind !== 'manufacturer' && kind !== 'amazon' && kind !== 'ebay') return [];
        const said = typeof src.value === 'string' ? src.value.trim() : '';
        if (!said) return [];
        return [{
          kind,
          value: said,
          ...(typeof src.url === 'string' && src.url ? { url: src.url } : {}),
          ...(typeof src.label === 'string' && src.label ? { label: src.label } : {}),
          ...(typeof src.at === 'string' && src.at ? { at: src.at } : {}),
        }];
      })
      : [];

    out[name] = {
      value,
      origins,
      ...(typeof rec.verifiedAt === 'string' && rec.verifiedAt ? { verifiedAt: rec.verifiedAt } : {}),
      ...(typeof rec.verifiedBy === 'string' && rec.verifiedBy ? { verifiedBy: rec.verifiedBy } : {}),
    };
  }
  return out;
}

/**
 * The values `resolveAspects` is allowed to treat as planned answers.
 *
 * Deliberately narrower than "everything stored": a held-back suggestion is absent here, so the
 * existing resolution falls through to the product's own brand or MPN, and `missingAspects` reports
 * a required one as still missing. Held back means held back at every layer, not only the payload.
 */
export function eligibleValues(records: Readonly<Record<string, AspectRecord>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, rec] of Object.entries(records)) {
    if (isPayloadEligible(rec)) out[name] = rec.value;
  }
  return out;
}

/**
 * Fold what a person typed into what is stored.
 *
 * Earlier origins are KEPT when a person overrides them. That the datasheet said 1200W and somebody
 * changed it to 1500W is the interesting part; discarding the datasheet would leave a value that
 * looks hand-typed and unremarkable.
 *
 * An emptied field deletes the answer outright. Storing an empty string would publish one.
 */
export function applyUserEdits(
  existing: Readonly<Record<string, AspectRecord>>,
  edits: Readonly<Record<string, string>>,
  at: string,
): Record<string, AspectRecord> {
  const out: Record<string, AspectRecord> = { ...existing };
  for (const [name, raw] of Object.entries(edits)) {
    const value = raw.trim();
    if (!value) { delete out[name]; continue; }

    const prior = existing[name];
    /** Re-typing the same value is a confirmation, not a second opinion; do not stack duplicates. */
    if (prior && same(prior.value, value) && prior.origins.some((o) => o.kind === 'user')) continue;

    out[name] = {
      value,
      origins: [...(prior?.origins ?? []), { kind: 'user', value, at }],
    };
  }
  return out;
}

/** A person has read the evidence and accepted it. */
export function verifyAspect(rec: AspectRecord, at: string, by?: string): AspectRecord {
  return { ...rec, verifiedAt: at, ...(by ? { verifiedBy: by } : {}) };
}

/**
 * Prisma's Json input rejects `unknown`, and an object assembled elsewhere can carry keys this
 * module does not know about. Rebuilt field by field so what lands in the column is exactly the
 * shape `normaliseAspects` can read back.
 */
export type JsonAspects = Record<string, {
  value: string;
  origins: Array<{ kind: string; value: string; url?: string; label?: string; at?: string }>;
  verifiedAt?: string;
  verifiedBy?: string;
}>;

export function toJson(records: Readonly<Record<string, AspectRecord>>): JsonAspects {
  const out: JsonAspects = {};
  for (const [name, rec] of Object.entries(records)) {
    out[name] = {
      value: rec.value,
      origins: rec.origins.map((o) => ({
        kind: o.kind,
        value: o.value,
        ...(o.url ? { url: o.url } : {}),
        ...(o.label ? { label: o.label } : {}),
        ...(o.at ? { at: o.at } : {}),
      })),
      ...(rec.verifiedAt ? { verifiedAt: rec.verifiedAt } : {}),
      ...(rec.verifiedBy ? { verifiedBy: rec.verifiedBy } : {}),
    };
  }
  return out;
}
