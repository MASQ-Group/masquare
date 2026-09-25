import type { OnbuyListingInput } from './onbuy-listing';
import { ONBUY_BOOST_LEVELS, onbuyCondition } from './onbuy-listing';

/**
 * Creating a product on OnBuy that its catalogue does not have yet, as pure logic.
 *
 * OnBuy queues a new product (POST /v2/products) and answers with a queue id; the product appears —
 * or is refused — when the queue is processed, usually within 30 minutes (GET /v2/queues). The
 * listing is sent inside the product request but starts with no price or stock, whatever was sent,
 * so a price and stock update by SKU follows once the queue succeeds. All of this is OnBuy's own
 * documented process (docs.api.onbuy.com, "Creating a Product").
 *
 * Only the OnBuy content is sent — the title, description and summary points written for OnBuy on the
 * product's OnBuy content tab, with the category's features and technical details researched there.
 * Our internal product name is never used: on OnBuy the first seller's content becomes the product
 * page, and is locked once others list against it.
 *
 * PURE.
 */

/** An OnBuy category a product can be created in. */
export interface OnbuyCategory {
  id: string;
  name: string;
  /** "Health & Beauty > Personal Care > Massagers", for a person telling similar names apart. */
  tree: string;
  canListIn: boolean;
}

/** Categories from a search, keeping only those OnBuy allows products in. */
export function parseOnbuyCategories(json: any): OnbuyCategory[] {
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];
  return rows
    .map((r) => ({
      id: r?.category_id != null ? String(r.category_id) : '',
      name: String(r?.name ?? '').trim(),
      tree: String(r?.category_tree || r?.name || '').trim(),
      canListIn: r?.can_list_in === true || r?.can_list_in === 1 || r?.can_list_in === '1',
    }))
    .filter((c) => c.id && c.canListIn);
}

/** What a new OnBuy product is made of, resolved from the product and its plan. */
export interface OnbuyProductInput {
  categoryId: string | null;
  name: string | null;
  description: string | null;
  summaryPoints: string[];
  brandName: string | null;
  productCode: string | null;
  mpn: string | null;
  /** OnBuy-ready image URLs, the featured one first. */
  images: string[];
  /** Our own reference, echoed back by OnBuy's queue. */
  uid: string;
  /** OnBuy option ids for the category's features, and its technical details. */
  features: { option_id: number }[];
  /** `unit` only where OnBuy says the detail has one — a detail with no units takes plain text. */
  technical: { detail_id: number; value: string; unit?: string }[];
  /** The free specification table. */
  productData: { label: string; value: string; group?: string }[];
  /** GPSR text, already in OnBuy's field names, and safety documents. */
  safety: Record<string, string> | null;
  safetyDocuments: { label: string; url: string; language: string }[];
  /** The model that wrote the content, when Claude did — sent as OnBuy's AI-content flag. */
  aiModel: string | null;
}

/** OnBuy's summary points are short bullets; more than five crowd the page. */
export const ONBUY_MAX_SUMMARY_POINTS = 5;
/** Additional images beyond the default one. */
export const ONBUY_MAX_ADDITIONAL_IMAGES = 9;

/** What still stops the product being created, in words. Empty means it may be sent. */
export function missingForOnbuyProduct(p: OnbuyProductInput, listing: OnbuyListingInput, extra: { contentGaps: string[] }): string[] {
  const gaps: string[] = [];
  if (!p.categoryId || !/^\d+$/.test(p.categoryId)) gaps.push('an OnBuy category (step 1)');
  if (!p.name) gaps.push('the OnBuy title — write it on the OnBuy content tab');
  if (!p.description) gaps.push('the OnBuy description — write it on the OnBuy content tab');
  gaps.push(...extra.contentGaps);
  if (!p.brandName) gaps.push('a brand on the product');
  if (!p.productCode) gaps.push('an EAN or UPC');
  if (!p.images.length) gaps.push('at least one image OnBuy can use');
  if (!listing.sku) gaps.push('a SKU');
  if (!onbuyCondition(listing.condition)) gaps.push('condition New');
  if (!(listing.price != null && listing.price > 0)) gaps.push('a price');
  if (!(listing.stock != null && listing.stock > 0)) gaps.push('stock above zero on the Availability page');
  if (!listing.deliveryTemplateId || !/^\d+$/.test(listing.deliveryTemplateId)) gaps.push('an OnBuy delivery template');
  if (!(ONBUY_BOOST_LEVELS as readonly number[]).includes(listing.boostPct)) gaps.push(`a boost of ${ONBUY_BOOST_LEVELS.join(', ')}%`);
  return gaps;
}

/** The product request, with our listing inside it. The site is added by the caller. */
export function buildOnbuyProductBody(p: OnbuyProductInput, l: OnbuyListingInput): Record<string, unknown> {
  const [defaultImage, ...rest] = p.images;
  return {
    uid: p.uid,
    category_id: Number(p.categoryId),
    published: 1,
    product_name: p.name,
    description: p.description,
    brand_name: p.brandName,
    product_codes: p.productCode ? [p.productCode] : [],
    ...(p.mpn ? { mpn: p.mpn } : {}),
    ...(p.summaryPoints.length ? { summary_points: p.summaryPoints.slice(0, ONBUY_MAX_SUMMARY_POINTS) } : {}),
    default_image: defaultImage,
    ...(rest.length ? { additional_images: rest.slice(0, ONBUY_MAX_ADDITIONAL_IMAGES) } : {}),
    ...(p.features.length ? { features: p.features } : {}),
    ...(p.technical.length ? { technical_detail: p.technical } : {}),
    ...(p.productData.length ? { product_data: p.productData } : {}),
    ...(p.safety ? { safety_content: p.safety } : {}),
    ...(p.safetyDocuments.length ? { safety_documents: p.safetyDocuments } : {}),
    // OnBuy's own AI-content flag, set whenever Claude wrote the words.
    ...(p.aiModel ? { ai_content_marked: true, ai_content_model_used: p.aiModel } : {}),
    listings: {
      new: {
        sku: l.sku,
        // Sent because OnBuy's example sends them; OnBuy states they are NOT applied on create, which
        // is why the activation update follows once the queue succeeds.
        price: Math.round((l.price ?? 0) * 100) / 100,
        stock: Math.max(0, Math.trunc(l.stock ?? 0)),
        delivery_template_id: Number(l.deliveryTemplateId),
        ...(l.handlingTimeDays != null ? { handling_time: l.handlingTimeDays } : {}),
        boost_marketing_commission: l.boostPct,
      },
    },
  };
}

/** The queue id OnBuy gave for our product, or its refusal. */
export function readOnbuyProductSubmit(json: any): { ok: boolean; queueId: string | null; message: string | null } {
  const results: any[] = Array.isArray(json?.results) ? json.results : json?.results ? [json.results] : [];
  const r = results[0] ?? json;
  const queueId = r?.queue_id ? String(r.queue_id) : null;
  if (r?.success === false || !queueId) {
    const m = r?.message ?? r?.error?.message ?? json?.error?.message ?? json?.message ?? (Array.isArray(r?.errors) ? r.errors.map((e: any) => e?.message ?? e).join('; ') : null);
    return { ok: false, queueId: null, message: m ? String(m).slice(0, 400) : 'OnBuy did not accept the product' };
  }
  return { ok: true, queueId, message: null };
}

/** Where one queued product has got to. */
export interface OnbuyQueueState {
  status: 'pending' | 'success' | 'failed' | 'unknown';
  opc: string | null;
  productUrl: string | null;
  message: string | null;
}

/**
 * One queue entry, read defensively: OnBuy documents the success and pending shapes, not the
 * failure one, so a failure's reason is taken from whichever field carries words.
 */
export function readOnbuyQueue(json: any, queueId: string): OnbuyQueueState {
  const raw = json?.results;
  const rows: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const r = rows.find((x) => String(x?.queue_id ?? '') === queueId) ?? (rows.length === 1 ? rows[0] : null);
  if (!r) return { status: 'unknown', opc: null, productUrl: null, message: 'OnBuy returned nothing for this queue entry' };
  const status = String(r.status ?? '').toLowerCase();
  const known = status === 'pending' || status === 'success' || status === 'failed' ? status : 'unknown';
  const words = r.error_message ?? r.message ?? r.error ?? (Array.isArray(r.errors) ? r.errors.map((e: any) => e?.message ?? e).join('; ') : null);
  return {
    status: known as OnbuyQueueState['status'],
    opc: r.opc ? String(r.opc) : null,
    productUrl: r.product_url ? String(r.product_url) : null,
    message: known === 'failed' ? (words ? String(words).slice(0, 400) : 'OnBuy could not create the product') : null,
  };
}

/**
 * The category most often chosen for products in the same internal category — the suggestion.
 *
 * Counts, not the latest: one product filed in the wrong OnBuy category should not become everyone
 * else's suggestion. Ties go to the most recently used.
 */
export function suggestOnbuyCategory(used: Array<{ categoryRef: string | null; categoryName: string | null; updatedAt: Date }>): { id: string; tree: string; uses: number } | null {
  const by = new Map<string, { id: string; tree: string; uses: number; last: number }>();
  for (const u of used) {
    if (!u.categoryRef || !/^\d+$/.test(u.categoryRef)) continue;
    const e = by.get(u.categoryRef) ?? { id: u.categoryRef, tree: u.categoryName ?? u.categoryRef, uses: 0, last: 0 };
    e.uses += 1;
    e.last = Math.max(e.last, u.updatedAt.getTime());
    by.set(u.categoryRef, e);
  }
  const best = [...by.values()].sort((a, b) => b.uses - a.uses || b.last - a.last)[0];
  return best ? { id: best.id, tree: best.tree, uses: best.uses } : null;
}
