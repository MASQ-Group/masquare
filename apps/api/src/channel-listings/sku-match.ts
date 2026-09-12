/**
 * Which product owns a SKU seen on a marketplace.
 *
 * A product is listed under its main SKU on one marketplace and under an alias on another, and the
 * stock figure is the same for all of them — it hangs off the product, not the SKU. So a listing is
 * only reachable by the availability push once something has linked it to a product, and that
 * linking is this.
 *
 * It used to happen only while a listing was being pulled. Define an alias AFTER its listing was
 * last synced and the row kept `productId = null` indefinitely: the listing stayed live on the
 * channel, the push could not see it, and its stock silently stopped being updated. Fourteen rows
 * on production were in exactly that state.
 */

/** Trimmed and lower-cased. Channels vary the case of a SKU between reports; we should not care. */
export function normaliseSku(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * Letters and digits only — the form in which `BE-BF600 BLACK` and `BE-BF600-BLACK` are one SKU.
 *
 * Thirteen live listings differed from a SKU the catalogue already held by nothing but a separator:
 * a space for a hyphen, a hyphen for nothing, a stray space after a prefix. Every one was invisible
 * to the availability push, which is stock somebody believed they were publishing and were not.
 */
export function looseSkuKey(raw: string | null | undefined): string {
  return normaliseSku(raw).replace(/[^a-z0-9]/g, '');
}

export type SkuOwner = { productId: string; sku: string; isMain: boolean };

/**
 * Index every SKU the catalogue knows to the product that owns it.
 *
 * A main SKU outranks an alias on collision. The namespace check is meant to make that impossible,
 * but an index that silently picked one of two would hide the day it stopped being true, and the
 * product's own SKU is the defensible answer if it ever happens.
 */
export function buildSkuOwnerIndex(
  products: readonly { id: string; mainSku: string; aliases: readonly { skuValue: string }[] }[],
): Map<string, SkuOwner> {
  const index = new Map<string, SkuOwner>();
  for (const p of products) {
    for (const a of p.aliases) {
      const k = normaliseSku(a.skuValue);
      if (!k) continue;
      if (!index.has(k)) index.set(k, { productId: p.id, sku: a.skuValue, isMain: false });
    }
  }
  // Second pass so a main SKU overwrites an alias that claimed the same string.
  for (const p of products) {
    const k = normaliseSku(p.mainSku);
    if (!k) continue;
    index.set(k, { productId: p.id, sku: p.mainSku, isMain: true });
  }
  return index;
}

/**
 * The same index keyed punctuation-insensitively — with the ambiguous keys deliberately emptied.
 *
 * Two products really can differ only by punctuation, and on this catalogue two still do:
 * `POT-CK920S-599` against `POT-CK920S599` are different sunglasses, and `Logistic-Services` against
 * `Logistic Services` have both sold. Letting a loose match pick one of those would attach a live
 * listing to whichever product the iteration order happened to reach first, and push the wrong stock
 * figure to a marketplace on the strength of it.
 *
 * So an ambiguous key maps to `null` rather than being left out: "several products claim this" is a
 * different answer from "nobody does", and only one of them is worth saying out loud. It also makes
 * the index self-healing — resolve the duplicate and the key becomes usable with no code change.
 */
export type LooseSkuIndex = Map<string, SkuOwner | null>;

export function buildLooseSkuIndex(
  products: readonly { id: string; mainSku: string; aliases: readonly { skuValue: string }[] }[],
): LooseSkuIndex {
  const claims = new Map<string, SkuOwner[]>();
  const claim = (key: string, owner: SkuOwner) => {
    if (!key) return;
    const seen = claims.get(key) ?? [];
    /**
     * One product reaching a key twice — a main SKU and an alias that squash alike, which is exactly
     * what the LAG rename left behind — is ONE claim. Only different products make a key ambiguous.
     */
    if (!seen.some((o) => o.productId === owner.productId)) claims.set(key, [...seen, owner]);
    else claims.set(key, seen);
  };

  for (const p of products) {
    for (const a of p.aliases) claim(looseSkuKey(a.skuValue), { productId: p.id, sku: a.skuValue, isMain: false });
    claim(looseSkuKey(p.mainSku), { productId: p.id, sku: p.mainSku, isMain: true });
  }

  const index: LooseSkuIndex = new Map();
  for (const [key, owners] of claims) index.set(key, owners.length > 1 ? null : owners[0]);
  return index;
}

export type SkuMatch =
  | { owner: SkuOwner; how: 'exact' | 'punctuation' }
  | { owner: null; how: 'ambiguous' | 'unknown' };

/**
 * Exact first, always. A SKU the catalogue holds verbatim is never reinterpreted.
 *
 * The loose pass runs only on a miss, so widening the rule cannot change an answer that already
 * existed — which is the property that makes this safe to turn on across seventeen thousand rows at
 * once. Without the loose index passed in, this is the old behaviour exactly.
 */
export function matchSku(
  sku: string,
  index: Map<string, SkuOwner>,
  loose?: LooseSkuIndex,
): SkuMatch {
  const exact = index.get(normaliseSku(sku));
  if (exact) return { owner: exact, how: 'exact' };
  if (!loose) return { owner: null, how: 'unknown' };
  const key = looseSkuKey(sku);
  if (!key || !loose.has(key)) return { owner: null, how: 'unknown' };
  const owner = loose.get(key);
  return owner ? { owner, how: 'punctuation' } : { owner: null, how: 'ambiguous' };
}

/**
 * What linking a row would do: nothing, claim an unlinked row, or move one to a different product.
 *
 * `move` is separated from `claim` because they deserve different amounts of trust. Claiming an
 * unlinked row only ever adds reach. Moving one changes which product's stock a live listing
 * follows, which is right when an alias is transferred between products and worth counting
 * separately either way.
 */
export type RelinkAction = 'none' | 'claim' | 'move' | 'unknown-sku';

export function relinkAction(
  row: { channelSku: string; productId: string | null },
  index: Map<string, SkuOwner>,
  loose?: LooseSkuIndex,
): { action: RelinkAction; productId: string | null; how: SkuMatch['how'] } {
  const match = matchSku(row.channelSku, index, loose);
  if (!match.owner) return { action: 'unknown-sku', productId: null, how: match.how };
  if (row.productId === match.owner.productId) {
    return { action: 'none', productId: match.owner.productId, how: match.how };
  }

  /**
   * A punctuation match may CLAIM an unlinked row. It may never MOVE a linked one.
   *
   * Claiming adds reach to a listing nothing was maintaining. Moving re-points a live listing at a
   * different product's stock — and inferring that from a separator is too much, because the exact
   * SKU has already named a product and named a different one.
   */
  if (row.productId && match.how === 'punctuation') {
    return { action: 'none', productId: row.productId, how: match.how };
  }
  return { action: row.productId ? 'move' : 'claim', productId: match.owner.productId, how: match.how };
}

/**
 * A product the catalogue nearly knows, for a SKU it does not.
 *
 * Thirty-eight unlinked SKUs are a known SKU with something on the end — `IT40779-FBA`,
 * `3G-011-631-00-750-FBA`. Those are almost certainly the same product listed under a fulfilment
 * alias nobody defined. But `BE-BS39 MIT` also matches `BE-BS39` this way, and MIT may well be a
 * colour, which would be a different product entirely.
 *
 * So this never links anything. It is only ever a SUGGESTION for the worklist — the difference
 * between "the catalogue may already have this" and "attach a live listing to it", and the whole
 * reason it is separate from `matchSku`.
 *
 * The longest prefix wins, so `A-B-C-FBA` is offered as `A-B-C` rather than `A-B`: the fewer
 * segments thrown away, the likelier the guess.
 */
export function suggestOwnerBySuffix(
  sku: string,
  index: Map<string, SkuOwner>,
  loose?: LooseSkuIndex,
): { owner: SkuOwner; matched: string; dropped: string } | null {
  const parts = normaliseSku(sku).split(/[-_.\s]+/).filter(Boolean);
  for (let n = parts.length - 1; n >= 1; n--) {
    const prefix = parts.slice(0, n).join('-');
    const match = matchSku(prefix, index, loose);
    if (match.owner) {
      return { owner: match.owner, matched: prefix, dropped: parts.slice(n).join('-') };
    }
  }
  return null;
}
