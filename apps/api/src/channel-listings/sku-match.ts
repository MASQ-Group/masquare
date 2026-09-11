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
): { action: RelinkAction; productId: string | null } {
  const owner = index.get(normaliseSku(row.channelSku));
  if (!owner) return { action: 'unknown-sku', productId: null };
  if (row.productId === owner.productId) return { action: 'none', productId: owner.productId };
  return { action: row.productId ? 'move' : 'claim', productId: owner.productId };
}
