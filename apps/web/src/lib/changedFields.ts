/**
 * The fields of `now` that differ from `opened` — what a person actually changed in a form.
 *
 * The product card used to send every field back on save, so a save made to fix one item specific
 * also wrote back the description exactly as it was when the card opened. When Claude had written a
 * description in the meantime, that save put the old, empty one back over it. Sending only what was
 * edited means a field nobody touched in the card cannot be overwritten by the card, whatever else
 * has changed on the server since.
 *
 * Compared by value (JSON), so a list or a money object rebuilt with the same contents is unchanged.
 * PURE.
 */
export function changedFields<T extends Record<string, unknown>>(opened: T, now: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(now) as (keyof T)[]) {
    if (JSON.stringify(opened[key]) !== JSON.stringify(now[key])) out[key] = now[key];
  }
  return out;
}
