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
/**
 * Every string and number anywhere in a product record.
 *
 * The last resort for tying an answer back to what was asked. An operator may carry the reference
 * under a name of its own, and a matcher that insists on `product_references` then reports "not
 * carried" about a product sitting in front of it. We asked for one exact reference; if that exact
 * string is anywhere in the record, the record is that product's.
 */
function everyValue(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out;
  if (typeof value === 'string') { const t = value.trim(); if (t) out.push(t); return out; }
  if (typeof value === 'number') { out.push(String(value)); return out; }
  if (Array.isArray(value)) { for (const v of value) everyValue(v, out, depth + 1); return out; }
  if (value && typeof value === 'object') { for (const v of Object.values(value)) everyValue(v, out, depth + 1); }
  return out;
}

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
    // And some under a name of their own, so the whole record is searched for what we asked.
    for (const v of everyValue(p)) if (!byReference.has(v)) byReference.set(v, p);
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

/** One of OUR live offers on Jinius, and what it is attached to in their catalogue. */
export interface JiniusOfferAttachment {
  /** Our own code, the one the offer was created with. */
  shopSku: string;
  /** Their code for the same thing — what a new offer would have to name. */
  productSku: string | null;
  title: string | null;
  /** Every reference Jinius itself holds for that product. This is the answer we came for. */
  references: { type: string; value: string }[];
}

/**
 * What our own live offers are attached to.
 *
 * The decisive read when a barcode lookup finds nothing: these offers exist, so whatever they name is
 * a reference Jinius certainly recognises. If they carry an EAN, the lookup was asked wrongly; if they
 * carry only a code of Jinius's own, its catalogue is not keyed on barcodes at all and a listing flow
 * has to work from that code instead.
 */
export function readJiniusOfferAttachments(json: unknown): JiniusOfferAttachment[] {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const offers: any[] = Array.isArray(body?.offers) ? body!.offers : [];
  return offers
    .map((o): JiniusOfferAttachment => {
      const raw: any[] = Array.isArray(o?.product_references) ? o.product_references : [];
      // Operators spell the pair differently; both spellings mean the same thing.
      const references = raw
        .map((r) => ({
          type: String(r?.reference_type ?? r?.type ?? '').trim().toUpperCase(),
          value: String(r?.reference ?? r?.value ?? '').trim(),
        }))
        .filter((r) => r.type && r.value);
      return {
        shopSku: typeof o?.shop_sku === 'string' ? o.shop_sku.trim() : '',
        productSku: o?.product_sku != null && String(o.product_sku).trim() ? String(o.product_sku).trim() : null,
        title: typeof o?.product_title === 'string' && o.product_title.trim() ? o.product_title.trim() : null,
        references,
      };
    })
    .filter((o) => o.shopSku || o.productSku);
}

/** The distinct reference types our own offers carry, in the order met, without repeats. */
export const offerReferenceTypes = (rows: readonly JiniusOfferAttachment[]): string[] =>
  [...new Set(rows.flatMap((o) => o.references.map((r) => r.type)))];

/** One lookup, asked one particular way, with what came back. */
export interface JiniusLookupAttempt {
  /** How we asked, in words — this is what a person reads in the report. */
  how: string;
  /** One reference, several at once, or no filter at all. */
  kind: 'single' | 'list' | 'unfiltered';
  /** `encoded` is what URLSearchParams produces; `documented` is Mirakl's own pipe and comma. */
  encoding: 'encoded' | 'documented';
  type: string;
  asked: number;
  status: number;
  /** How many products came back, or null when the answer carried no product list at all. */
  products: number | null;
  /**
   * How many of those tied back to a reference we asked for.
   *
   * Separate from `products` on purpose: an answer full of products that tie back to nothing is a
   * reply we are reading wrongly, and reporting that as "they do not carry it" would be a lie.
   */
  matched: number | null;
  excerpt: string;
}

/** What the attempts add up to, and what to do about it. */
export interface JiniusLookupAnswer {
  /** Jinius returns products for what we ask. */
  works: boolean;
  /** And we can tie those products back to the references we asked for. */
  matchesBack: boolean;
  /** Ask for one reference per request: a list comes back empty however it is sent. */
  askOneAtATime: boolean;
  /** Send the separators unencoded: the same list works that way and not encoded. */
  sendUnencoded: boolean;
  /** The reference type that answered. */
  type: string | null;
  message: string;
}

/**
 * What the lookups add up to.
 *
 * Every reference asked about comes off one of our own live offers, so Jinius holds all of them. An
 * empty answer therefore says something about how we asked, never about what they carry — and the
 * attempts differ only in how, so the difference between them IS the answer.
 */
export function readLookupAnswer(attempts: readonly JiniusLookupAttempt[]): JiniusLookupAnswer {
  // A hit is an answer we could READ: products came back AND tied back to what we asked for.
  const hit = (k: JiniusLookupAttempt['kind'], e?: JiniusLookupAttempt['encoding']) =>
    attempts.find((a) => a.kind === k && (e ? a.encoding === e : true) && (a.matched ?? 0) > 0) ?? null;
  const listEncoded = hit('list', 'encoded');
  const listDocumented = hit('list', 'documented');
  const single = hit('single');
  const none = { works: false, matchesBack: false, askOneAtATime: false, sendUnencoded: false, type: null, message: '' };

  if (!attempts.length) return { ...none, message: 'There was nothing live to look up with, so the lookup was not tested.' };

  if (listEncoded) {
    return {
      works: true, matchesBack: true, askOneAtATime: false, sendUnencoded: false, type: listEncoded.type,
      message: `Jinius answers a list of ${listEncoded.type} references exactly as the platform already sends it, `
        + 'so matching products is a solved problem and the listing flow can be built on it.',
    };
  }
  if (listDocumented) {
    return {
      works: true, matchesBack: true, askOneAtATime: false, sendUnencoded: true, type: listDocumented.type,
      message: `Jinius understands a list of ${listDocumented.type} references only when the pipe and comma are sent as `
        + 'Mirakl documents them, and we were percent-encoding both. Sending them unencoded is the fix.',
    };
  }
  if (single) {
    return {
      works: true, matchesBack: true, askOneAtATime: true, sendUnencoded: false, type: single.type,
      message: `Jinius answers one ${single.type} at a time and returns nothing usable for a list, however the list is `
        + 'sent. Matching works — the lookup just has to ask for one barcode per request.',
    };
  }

  /**
   * Products came back, and not one of them tied back to what we asked for.
   *
   * That is OUR fault, not theirs, and saying so is the whole point: the alternative is a report
   * full of "they do not carry it" about products sitting in the answer.
   */
  const answered = attempts.find((a) => (a.products ?? 0) > 0);
  if (answered) {
    return {
      works: true, matchesBack: false, askOneAtATime: false, sendUnencoded: false, type: answered.type,
      message: `Jinius answers the lookup — ${answered.products} product(s) came back for ${answered.asked} `
        + `${answered.type} reference(s) — but none tie back to the references we asked for, so we are reading their `
        + 'reply wrongly rather than being told they do not carry it. The verbatim answer below shows the shape.',
    };
  }
  return {
    ...none,
    message: 'Every lookup came back empty, including ones for references taken straight off our own live offers. '
      + 'Their product search is not open to this shop, so listing has to go through product import rather than '
      + 'matching against what they already carry.',
  };
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
