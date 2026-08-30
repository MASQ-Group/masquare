import type { Category } from './api';

/** Separator between path segments. Not ">" so it never collides with a name containing one. */
const SEP = ' › ';

/**
 * Categories rendered as their full path, in tree order.
 *
 * The catalogue taxonomy is three levels deep with 234 leaves, and leaf names are only unique
 * within their parent — "Filters", "Accessories" and "Sets" all recur. A flat list of names
 * therefore offers the same label several times with no way to tell which is which, so every
 * picker shows the whole path.
 *
 * Order is depth-first by the curated sortOrder, which keeps a branch's children directly under
 * it rather than scattering them alphabetically across the list.
 */
export function categoryOptions(categories: Category[]): { id: string; name: string; depth: number }[] {
  const childrenOf = new Map<string, Category[]>();
  for (const c of categories) {
    const key = c.parentId ?? 'root';
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(c);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  const out: { id: string; name: string; depth: number }[] = [];
  const walk = (parentKey: string, prefix: string, depth: number) => {
    for (const c of childrenOf.get(parentKey) ?? []) {
      const path = prefix ? `${prefix}${SEP}${c.name}` : c.name;
      out.push({ id: c.id, name: path, depth });
      walk(c.id, path, depth + 1);
    }
  };
  walk('root', '', 0);

  // A category whose parent was soft-deleted would otherwise vanish from every picker, taking its
  // products' category with it. Append any such orphan rather than silently dropping it.
  if (out.length < categories.length) {
    const placed = new Set(out.map((o) => o.id));
    for (const c of categories) if (!placed.has(c.id)) out.push({ id: c.id, name: c.name, depth: 0 });
  }
  return out;
}

/** Full path for one category id, falling back to the bare name, then to an em dash. */
export function categoryPath(categories: Category[] | undefined, id: string): string {
  if (!categories) return '—';
  return categoryOptions(categories).find((c) => c.id === id)?.name ?? '—';
}
