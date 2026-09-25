/**
 * Talking to Jinius, the Cyprus marketplace — which runs on Mirakl, so this speaks Mirakl's seller API.
 *
 * Mirakl's own rules (developer.mirakl.com, "General Notes"):
 *   - the API key goes in the `Authorization` header AS IT IS. No "Bearer": a prefix is rejected.
 *   - HTTPS only, and JSON is the format to ask for.
 *   - `shop_id` is a query parameter, needed only when the key reaches more than one shop.
 *
 * The base URL is a field rather than a constant: every Mirakl marketplace has its own host, and
 * Jinius's is in the API guide they issue with the key.
 *
 * PURE.
 */

/** Mirakl endpoints this platform uses, by Mirakl's own codes. */
export const JINIUS_PATHS = {
  /** OF21 — list a shop's offers. Meant for repeated calls, which is why the connection test uses it. */
  offers: '/api/offers',
  /** A01 — shop information. Mirakl allows this ONCE A DAY, so never on a button. */
  account: '/api/account',
  /** OR11 — orders, newest first. */
  orders: '/api/orders',
} as const;

/** The host with any trailing slash and a trailing `/api` removed — both are easy to paste in. */
export function jiniusBase(raw: string): string {
  return (raw ?? '').trim().replace(/\s+/g, '').replace(/\/+$/, '').replace(/\/api$/i, '');
}

/**
 * A Jinius URL.
 *
 * `rawParams` are appended exactly as given, without percent-encoding. Mirakl documents product
 * lookups as `product_references=EAN|123,EAN|456` — pipe and comma as they are — and a gateway that
 * does not decode `%7C` and `%2C` answers 200 with nothing found, which reads as "not carried" and is
 * not. Everything ordinary goes through `params`, which encodes properly; `rawParams` exists so we can
 * ask the documented way as well and see which one the marketplace understands.
 */
export function jiniusUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string | number | undefined | null> = {},
  rawParams: Record<string, string | undefined | null> = {},
): string {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') query.set(k, String(v));
  }
  const raw = Object.entries(rawParams)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k}=${v}`);
  const q = [query.toString(), ...raw].filter(Boolean).join('&');
  return `${jiniusBase(baseUrl)}${path}${q ? `?${q}` : ''}`;
}

/** Mirakl takes the key raw. Sending "Bearer <key>" is the classic first mistake, and answers 401. */
export function jiniusHeaders(apiKey: string): Record<string, string> {
  return { Authorization: (apiKey ?? '').trim(), Accept: 'application/json' };
}

/** A base URL that is plainly not a Mirakl host, said before a call is made. */
export function jiniusUrlProblem(raw: string): string | null {
  const base = jiniusBase(raw);
  if (!base) return 'No API base URL. The Jinius API guide gives it with the key.';
  if (!/^https:\/\//i.test(base)) return 'The API base URL must start with https:// — Mirakl refuses anything else.';
  if (/\s/.test(base)) return 'The API base URL contains a space.';
  return null;
}

export interface JiniusOutcome { ok: boolean; message: string }

/**
 * What one connection test means, in the words a person needs next.
 *
 * Each failure names the thing to change: a key Mirakl did not accept, a key that reaches no shop, a
 * host that is not the marketplace. "Request failed with status 403" sends nobody anywhere.
 */
export function readJiniusTest(status: number, body: unknown, shopId?: string | null): JiniusOutcome {
  const json = body && typeof body === 'object' ? (body as Record<string, any>) : null;
  const said = (json?.message ?? json?.error_message ?? (typeof body === 'string' ? body : '')) as string;
  const detail = said ? `: ${String(said).slice(0, 160)}` : '';

  if (status === 200) {
    const count = typeof json?.total_count === 'number' ? json.total_count : null;
    const where = shopId ? ` for shop ${shopId}` : '';
    return {
      ok: true,
      message: count == null
        ? `Connected to Jinius${where}.`
        : `Connected to Jinius${where} — ${count} offer${count === 1 ? '' : 's'} on the shop.`,
    };
  }
  if (status === 401) return { ok: false, message: `Jinius did not accept the API key (401)${detail}. Check it was copied whole, and that it is still active.` };
  if (status === 403) return { ok: false, message: `The key is valid but not allowed here (403)${detail}. Check the Shop ID, and that the key has the seller API permissions.` };
  if (status === 404) return { ok: false, message: 'Jinius answered 404 — the API base URL is probably wrong. It is the marketplace host from the API guide, not the seller portal.' };
  if (status === 429) return { ok: false, message: 'Jinius is rate-limiting this key (429). Wait a minute and test again.' };
  if (status >= 500) return { ok: false, message: `Jinius had a server error (${status})${detail}. Nothing is wrong at our end; try again later.` };
  return { ok: false, message: `Jinius answered ${status}${detail}.` };
}


/** One Jinius offer in the shape the channel-listings sync stores, whatever channel it came from. */
export interface JiniusListingRow {
  sku: string;
  asin: string | null;
  externalId: string | null;
  title: string | null;
  quantity: number | null;
  price: number | null;
  currency: string | null;
  fulfilmentChannel: 'FBM' | 'FBA' | null;
  status: string | null;
  marketplace: string | null;
}

/**
 * One page of OF21 as listing rows.
 *
 * `shop_sku` is the seller's OWN sku — the one that matches a product here. `product_sku` is the
 * marketplace's product identifier and matches nothing of ours, so an offer without a shop_sku is
 * dropped rather than stored under a code nobody can look up.
 *
 * An offer can exist and not be for sale: `active: false` is kept as INACTIVE so the listing reads
 * as what it is rather than as a live offer.
 */
export function readJiniusOffers(json: unknown, currency = 'EUR'): { rows: JiniusListingRow[]; totalCount: number | null } {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const offers: any[] = Array.isArray(body?.offers) ? body!.offers : [];
  const rows = offers
    .map((o): JiniusListingRow => ({
      sku: typeof o?.shop_sku === 'string' ? o.shop_sku.trim() : '',
      asin: null,
      externalId: o?.offer_id != null ? String(o.offer_id) : null,
      title: typeof o?.product_title === 'string' && o.product_title.trim() ? o.product_title.trim() : null,
      quantity: o?.quantity != null && Number.isFinite(Number(o.quantity)) ? Number(o.quantity) : null,
      price: o?.price != null && Number.isFinite(Number(o.price)) ? Number(o.price) : null,
      currency: (currency || 'EUR').toUpperCase(),
      fulfilmentChannel: null,
      status: o?.active === false ? 'INACTIVE' : (typeof o?.state_code === 'string' && o.state_code ? o.state_code : 'ACTIVE'),
      marketplace: null,
    }))
    .filter((r) => r.sku);
  return { rows, totalCount: typeof body?.total_count === 'number' ? body!.total_count : null };
}
