/**
 * Listing a product on OnBuy, as pure logic: what is sent, and how OnBuy's replies are read.
 *
 * The first release lists against products ALREADY in OnBuy's catalogue. OnBuy keeps one catalogue
 * product per item — its OPC — and each seller attaches a listing (SKU, condition, price, stock) to
 * it. A product is found by its barcode; one that is not there yet cannot be listed this way, and
 * creating new catalogue products is a later step.
 *
 * Field names and valid values come from OnBuy's published API collection (docs.api.onbuy.com):
 * the create call is POST /v2/listings with one entry per listing, and a listing only goes live
 * after a price and stock update by SKU (PUT /v2/listings/by-sku) — OnBuy's own guidance.
 *
 * PURE.
 */

/** The boost levels OnBuy accepts. Anything else is refused by OnBuy, so it is refused here first. */
export const ONBUY_BOOST_LEVELS = [0, 5, 10, 15, 20, 30] as const;

/** One product in OnBuy's catalogue that could take our listing. */
export interface OnbuyCandidate {
  opc: string;
  name: string;
  url: string | null;
  thumbnailUrl: string | null;
  productCodes: string[];
  /** Which of our barcodes it carries, so the screen can say why it was offered. */
  matchedCode: string | null;
}

/** Barcodes compared as digits: "0 714756 422435" and "0714756422435" are the same code. */
const digits = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');

/**
 * Catalogue products from a barcode search, keeping only those that really carry one of our codes.
 *
 * OnBuy's search is a text search over the product-code field. Filtering the results by exact
 * barcode is what stops a partial match — a longer code that happens to contain ours — from being
 * offered as the same product.
 */
export function parseOnbuySearch(json: any, ourCodes: string[]): OnbuyCandidate[] {
  const wanted = new Set(ourCodes.map(digits).filter((c) => c.length >= 8));
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];
  const out: OnbuyCandidate[] = [];
  for (const r of rows) {
    const opc = String(r?.opc ?? '').trim();
    if (!opc) continue;
    const codes: string[] = (Array.isArray(r?.product_codes) ? r.product_codes : []).map((c: unknown) => String(c));
    const matched = codes.find((c) => wanted.has(digits(c))) ?? null;
    if (!matched) continue;
    out.push({
      opc,
      name: String(r?.name ?? '').trim(),
      url: r?.url ? String(r.url) : null,
      thumbnailUrl: r?.thumbnail_url ? String(r.thumbnail_url) : null,
      productCodes: codes,
      matchedCode: matched,
    });
  }
  // One entry per OPC, first seen kept.
  return out.filter((c, i) => out.findIndex((x) => x.opc === c.opc) === i);
}

/** A delivery template on the seller account, as a person would pick it. */
export interface OnbuyDeliveryTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  /** "Mainland UK: Free Delivery, 3-5 Days" and the like, for telling templates apart. */
  summary: string[];
}

/**
 * The seller's delivery templates, from OnBuy's one-row-per-region list.
 *
 * OnBuy returns a row for every region a template covers; a person chooses the template. Grouped by
 * `seller_delivery_template_id`, with each region's charge and time kept as a line of summary.
 */
export function parseOnbuyDeliveryTemplates(json: any): OnbuyDeliveryTemplate[] {
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];
  const byId = new Map<string, OnbuyDeliveryTemplate>();
  for (const r of rows) {
    const id = r?.seller_delivery_template_id != null ? String(r.seller_delivery_template_id) : '';
    if (!id) continue;
    const t = byId.get(id) ?? { id, name: String(r?.template_name ?? `Template ${id}`), isDefault: !!r?.is_default_template, summary: [] };
    const line = [r?.country_sub_region ?? r?.country, [r?.delivery_charge_type, r?.delivery_time].filter(Boolean).join(', ')].filter(Boolean).join(': ');
    if (line && !t.summary.includes(line)) t.summary.push(line);
    t.isDefault = t.isDefault || !!r?.is_default_template;
    byId.set(id, t);
  }
  return [...byId.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/** Our condition as OnBuy's. Only new is listed from here; graded refurbished needs OnBuy's own grades. */
export function onbuyCondition(planCondition: string | null | undefined): 'new' | null {
  return (planCondition ?? 'NEW').toUpperCase() === 'NEW' ? 'new' : null;
}

/** Everything one listing needs, resolved. */
export interface OnbuyListingInput {
  opc: string | null;
  sku: string | null;
  condition: string | null;
  /** In the site's currency — GBP for OnBuy UK — as a decimal. */
  price: number | null;
  stock: number | null;
  deliveryTemplateId: string | null;
  handlingTimeDays: number | null;
  boostPct: number;
}

/** What still stops this listing, in words. Empty means it may be sent. */
export function missingForOnbuyListing(i: OnbuyListingInput): string[] {
  const gaps: string[] = [];
  if (!i.opc) gaps.push('the product found on OnBuy (step 1)');
  if (!i.sku) gaps.push('a SKU');
  if (!onbuyCondition(i.condition)) gaps.push('condition New — OnBuy refurbished grades are not listed from here');
  if (!(i.price != null && i.price > 0)) gaps.push('a price');
  if (!(i.stock != null && i.stock > 0)) gaps.push('stock above zero on the Availability page');
  if (!i.deliveryTemplateId || !/^\d+$/.test(i.deliveryTemplateId)) gaps.push('an OnBuy delivery template');
  if (i.handlingTimeDays != null && !(Number.isInteger(i.handlingTimeDays) && i.handlingTimeDays >= 0)) gaps.push('a handling time in whole days');
  if (!(ONBUY_BOOST_LEVELS as readonly number[]).includes(i.boostPct)) gaps.push(`a boost of ${ONBUY_BOOST_LEVELS.join(', ')}%`);
  return gaps;
}

const money = (n: number) => Math.round(n * 100) / 100;

/** The create request: one listing on one catalogue product. The site is added by the caller. */
export function buildOnbuyCreateBody(i: OnbuyListingInput): { listings: Array<Record<string, unknown>> } {
  return {
    listings: [{
      opc: i.opc,
      sku: i.sku,
      condition: onbuyCondition(i.condition),
      price: money(i.price ?? 0),
      stock: Math.max(0, Math.trunc(i.stock ?? 0)),
      delivery_template_id: Number(i.deliveryTemplateId),
      ...(i.handlingTimeDays != null ? { handling_time: i.handlingTimeDays } : {}),
      boost_marketing_commission: i.boostPct,
    }],
  };
}

/**
 * The price and stock update that makes the listing live.
 *
 * Sent after the create, always: OnBuy's guidance is that a listing activates on a stock and price
 * update by SKU, and a create that carried them is not guaranteed to. Sending it twice costs one call.
 */
export function buildOnbuyActivateBody(i: OnbuyListingInput): { listings: Array<Record<string, unknown>> } {
  return { listings: [{ sku: i.sku, price: money(i.price ?? 0), stock: Math.max(0, Math.trunc(i.stock ?? 0)) }] };
}

/** OnBuy's own words for a refusal, from whichever shape it used. */
export function onbuyErrorMessage(json: any, status: number): string {
  const m = json?.error?.message ?? json?.message ?? json?.errors?.[0]?.message ?? json?.results?.[0]?.message ?? null;
  return m ? String(m).slice(0, 300) : `OnBuy answered ${status}`;
}

/** What happened to our one listing in a create reply. */
export function readOnbuyCreateResult(json: any, sku: string): {
  ok: boolean; created: boolean; listingId: string | null; opc: string | null; message: string | null;
} {
  const results: any[] = Array.isArray(json?.results) ? json.results : [];
  const r = results.find((x) => String(x?.sku ?? '') === sku) ?? results[0];
  if (!r) return { ok: false, created: false, listingId: null, opc: null, message: 'OnBuy returned no result for this listing' };
  const ok = r.success !== false;
  return {
    ok,
    created: !!r.created,
    listingId: r.product_listing_id != null ? String(r.product_listing_id) : null,
    opc: r.opc ? String(r.opc) : null,
    message: ok ? null : String(r.message ?? r.error ?? 'OnBuy refused the listing').slice(0, 300),
  };
}

/**
 * Whether to create, or why not.
 *
 * OnBuy keys a listing on the SKU across the whole account. A SKU already listed against the SAME
 * product means this is done already; against a DIFFERENT product it is a clash that a create would
 * turn into a second item under one SKU, so it is refused and named.
 */
export function onbuyIdentity(p: {
  sku: string;
  opc: string;
  planStatus: string | null;
  existing: Array<{ sku: string; opc: string | null }>;
}): { action: 'create' | 'listed' | 'refuse'; reason: string | null } {
  const same = p.existing.filter((e) => e.sku === p.sku);
  if (same.some((e) => e.opc === p.opc)) return { action: 'listed', reason: `SKU ${p.sku} is already listed on this OnBuy product.` };
  const other = same.find((e) => e.opc && e.opc !== p.opc);
  if (other) return { action: 'refuse', reason: `SKU ${p.sku} is already listed on OnBuy against a different product (${other.opc}). Use another SKU, or fix that listing first.` };
  if (p.planStatus === 'LISTED') return { action: 'listed', reason: 'This plan is already recorded as listed on OnBuy.' };
  return { action: 'create', reason: null };
}
