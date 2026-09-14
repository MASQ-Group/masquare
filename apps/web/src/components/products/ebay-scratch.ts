import { useState } from 'react';

/**
 * Work in progress on the eBay content tab, kept alive while you are looking at another tab.
 *
 * The product card unmounts a tab's contents the moment you leave it. For most tabs that costs
 * nothing — they are form fields whose values live in the modal above them. The eBay content tab is
 * different: almost everything on it is the RESULT of asking somebody else. A category search is a
 * round trip to eBay; a gather is a round trip to Amazon and several seconds. Losing those because
 * somebody went to check a dimension on Package & logistics means doing the work again to get the
 * same answer, and it makes the tab feel like it forgets what you just did.
 *
 * So this is a scratchpad: the contents of forms nobody has finished filling in. It is deliberately
 * NOT state, cache, or storage.
 *
 *   - Keyed by product and section, so two products never show each other's work.
 *   - Module-level, so it dies with the page. A half-finished search is not worth persisting across
 *     a reload, and a stale one restored days later would argue with what is actually saved.
 *   - Cleared explicitly once the work it represents has been saved, because from that moment the
 *     saved record is the answer and the scratchpad would be a second, older opinion.
 *
 * Anything genuinely saved belongs in the database and arrives through a query, not here.
 */
const store = new Map<string, unknown>();

/**
 * Like `useState`, but the value survives this component being unmounted and mounted again.
 *
 * Patch rather than replace, so a caller changing one field cannot accidentally drop the rest — the
 * failure mode of a scratchpad is silently losing part of it, which looks exactly like the bug it
 * was built to fix.
 */
export function useScratch<T extends object>(key: string, initial: T): [T, (patch: Partial<T>) => void] {
  const [state, setState] = useState<T>(() => (store.get(key) as T | undefined) ?? initial);

  const patch = (p: Partial<T>) => setState((s) => {
    const next = { ...s, ...p };
    store.set(key, next);
    return next;
  });

  return [state, patch];
}

/** Forget this scratch — the work it held has been saved, or abandoned. */
export function clearScratch(key: string): void {
  store.delete(key);
}

/** One namespace per product and section, so the keys cannot collide by accident. */
export const scratchKey = (productId: string, section: string) => `${productId}:${section}`;
