/**
 * What Jinius lets a seller do with its catalogue, read from Jinius rather than assumed.
 *
 * Mirakl marketplaces are configured per operator: which product references they match on, which
 * categories exist, which attributes a category demands, and whether sellers may add products at all
 * (many operators keep that to themselves). None of it is in the API documentation, because none of
 * it is the same twice — so it is asked for before anything is built on a guess.
 *
 * PURE.
 */

/** A category as `GET /api/hierarchies` reports it. */
export interface JiniusCategory {
  code: string;
  label: string;
  level: number | null;
  /** Whether the operator allows products to be created in it, where it says. */
  leaf: boolean;
}

export function readJiniusHierarchies(json: unknown): { categories: JiniusCategory[]; total: number | null } {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const rows: any[] = Array.isArray(body?.hierarchies) ? body!.hierarchies : Array.isArray(body) ? (body as any[]) : [];
  const categories = rows
    .map((h): JiniusCategory => ({
      code: String(h?.code ?? '').trim(),
      label: String(h?.label ?? h?.code ?? '').trim(),
      level: h?.level != null && Number.isFinite(Number(h.level)) ? Number(h.level) : null,
      // Mirakl marks the end of a branch differently per operator; both spellings are honoured.
      leaf: h?.leaf === true || h?.is_leaf === true,
    }))
    .filter((c) => c.code);
  return { categories, total: typeof body?.total_count === 'number' ? body!.total_count : categories.length || null };
}

/** One attribute a category asks for, as `GET /api/products/attributes` reports it. */
export interface JiniusAttribute {
  code: string;
  label: string;
  /** REQUIRED, RECOMMENDED, OPTIONAL or DISABLED — the operator's own wording. */
  requirement: string;
  type: string | null;
  /** The code of the value list this attribute must be answered from, where it has one. */
  valuesList: string | null;
  hierarchy: string | null;
  variant: boolean;
}

export function readJiniusAttributes(json: unknown): JiniusAttribute[] {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const rows: any[] = Array.isArray(body?.attributes) ? body!.attributes : Array.isArray(body) ? (body as any[]) : [];
  return rows
    .map((a): JiniusAttribute => ({
      code: String(a?.code ?? '').trim(),
      label: String(a?.label ?? a?.code ?? '').trim(),
      requirement: String(a?.requirement_level ?? 'OPTIONAL').toUpperCase(),
      type: a?.type != null ? String(a.type) : null,
      valuesList: a?.values_list != null && String(a.values_list).trim() ? String(a.values_list).trim() : null,
      hierarchy: a?.hierarchy_code != null && String(a.hierarchy_code).trim() ? String(a.hierarchy_code).trim() : null,
      variant: a?.variant === true,
    }))
    .filter((a) => a.code && a.requirement !== 'DISABLED');
}

export const requiredAttributes = (attrs: readonly JiniusAttribute[]): JiniusAttribute[] =>
  attrs.filter((a) => a.requirement === 'REQUIRED');

/** One of our products, looked up in Jinius's catalogue by its barcode. */
export interface JiniusCatalogueMatch {
  /** The barcode we asked about. */
  reference: string;
  found: boolean;
  /** What an offer would be created against: Mirakl's own product id and the type it is. */
  productId: string | null;
  productIdType: string | null;
  title: string | null;
  categoryCode: string | null;
  categoryLabel: string | null;
}

/**
 * P31's answer, read back against what we asked.
 *
 * Mirakl answers with the products it found and says nothing about the ones it did not, so the
 * references are matched back: a barcode missing from the reply is a product Jinius does not carry,
 * which is the interesting half of the answer.
 */
export function readJiniusProductMatches(json: unknown, asked: readonly string[]): JiniusCatalogueMatch[] {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const rows: any[] = Array.isArray(body?.products) ? body!.products : [];
  const byReference = new Map<string, any>();
  for (const p of rows) {
    const refs: any[] = Array.isArray(p?.product_references) ? p.product_references : [];
    for (const r of refs) {
      const value = String(r?.reference ?? r?.value ?? '').trim();
      if (value) byReference.set(value, p);
    }
    // Some operators answer with the reference only at the top level.
    const single = String(p?.product_reference ?? '').trim();
    if (single) byReference.set(single, p);
  }
  return asked.map((reference) => {
    const p = byReference.get(reference.trim()) ?? null;
    return {
      reference,
      found: !!p,
      productId: p?.product_id != null ? String(p.product_id) : null,
      productIdType: p?.product_id_type != null ? String(p.product_id_type) : null,
      title: p?.product_title != null ? String(p.product_title) : null,
      categoryCode: p?.category_code != null ? String(p.category_code) : null,
      categoryLabel: p?.category_label != null ? String(p.category_label) : null,
    };
  });
}

/** What one probed capability came back as, in words a person can act on. */
export interface JiniusCapability {
  name: string;
  allowed: boolean;
  detail: string;
}

/**
 * Whether the seller may add products to Jinius's catalogue.
 *
 * Asked by reading the product-import list, which needs the same permission as creating one: a 403
 * means the operator keeps its catalogue closed, and the honest answer then is that we can only sell
 * what Jinius already carries.
 */
export function readImportPermission(status: number): JiniusCapability {
  if (status === 200) return { name: 'Add products to the catalogue', allowed: true, detail: 'Jinius accepts product imports from this shop.' };
  if (status === 403) return { name: 'Add products to the catalogue', allowed: false, detail: 'Jinius does not allow this shop to add catalogue products (403). We can only list against products Jinius already carries.' };
  if (status === 404) return { name: 'Add products to the catalogue', allowed: false, detail: 'Jinius does not offer the product-import endpoint (404), so its catalogue is not open to sellers.' };
  return { name: 'Add products to the catalogue', allowed: false, detail: `Jinius answered ${status} when asked about product imports.` };
}
