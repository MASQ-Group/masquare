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
  /** OF02 — how an offer import ended. Mirakl applies offer writes after accepting them. */
  offerImports: '/api/offers/imports',
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
 * `shop_sku` is the seller's OWN sku — the one that matches a product here. An offer that carries
 * none is not dropped: it falls back to Mirakl's own product sku, because an offer nobody here can
 * see is stock nobody here can maintain. Those arrive unlinked, which is a worklist item rather
 * than a silence, and `skuless` counts them so a sync can say how many there were.
 *
 * `status` is deliberately NULL for a live offer. The field means Amazon's buyability answer, and
 * everything that reads it treats a non-null value that is not BUYABLE as "cannot be bought". Mirakl
 * has no such field — its `state_code` is the CONDITION of the goods ("11" is new) — so putting that
 * here read as paused across all 690 live Jinius offers. An offer Mirakl marks inactive is a real
 * "not for sale" and keeps a value that says so.
 *
 * The QUANTITY is `available_quantity`, not `quantity`. Mirakl sends both: `quantity` is the figure
 * the seller set on the offer, `available_quantity` is what is left to sell once Mirakl's own holds
 * come off — and the second is what their seller portal shows and what a buyer can actually order.
 * Reading the first had 65-16567828 showing 3 units here against 1 on Jinius. `heldBack` counts the
 * offers where the two disagree, because a gap that appears across many offers at once is worth
 * seeing rather than discovering one SKU at a time.
 */
export function readJiniusOffers(json: unknown, currency = 'EUR'): { rows: JiniusListingRow[]; totalCount: number | null; skuless: number; heldBack: number } {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const offers: any[] = Array.isArray(body?.offers) ? body!.offers : [];
  let skuless = 0;
  let heldBack = 0;
  const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const rows = offers
    .map((o): JiniusListingRow => {
      const shopSku = typeof o?.shop_sku === 'string' ? o.shop_sku.trim() : '';
      if (!shopSku) skuless += 1;
      const productSku = o?.product_sku != null ? String(o.product_sku).trim() : '';
      const declared = num(o?.quantity);
      const available = num(o?.available_quantity);
      if (available != null && declared != null && available !== declared) heldBack += 1;
      return {
        sku: shopSku || productSku,
        asin: null,
        externalId: o?.offer_id != null ? String(o.offer_id) : null,
        title: typeof o?.product_title === 'string' && o.product_title.trim() ? o.product_title.trim() : null,
        // What can actually be bought. An operator that sends no available_quantity has only the one.
        quantity: available ?? declared,
        price: o?.price != null && Number.isFinite(Number(o.price)) ? Number(o.price) : null,
        currency: (currency || 'EUR').toUpperCase(),
        fulfilmentChannel: null,
        status: o?.active === false ? 'INACTIVE' : null,
        marketplace: null,
      };
    })
    .filter((r) => r.sku);
  return { rows, totalCount: typeof body?.total_count === 'number' ? body!.total_count : null, skuless, heldBack };
}

/**
 * One offer to change on Jinius (Mirakl OF24).
 *
 * Only the fields given are sent, and `update` leaves everything else on the offer alone: a stock
 * push must not quietly restate a price, and a price change must not restate a quantity.
 */
export interface JiniusOfferWrite {
  shopSku: string;
  price?: number;
  quantity?: number;
}

export function jiniusOfferUpdateBody(writes: readonly JiniusOfferWrite[]): { offers: Record<string, unknown>[] } {
  return {
    offers: writes.map((w) => ({
      shop_sku: w.shopSku,
      update_delete: 'update',
      ...(w.price != null && Number.isFinite(w.price) ? { price: Number(w.price.toFixed(2)) } : {}),
      // Mirakl takes whole units, and a negative quantity is not a thing we can mean.
      ...(w.quantity != null && Number.isFinite(w.quantity) ? { quantity: Math.max(0, Math.round(w.quantity)) } : {}),
    })),
  };
}

/** Mirakl answers an offer write with the id of the import it queued, not with the result. */
export function readJiniusImportId(json: unknown): number | null {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const raw = body?.import_id ?? body?.importId ?? null;
  return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

/** How an offer import ended, as Mirakl reports it while it runs and once it is done. */
export interface JiniusImportReport {
  status: string;
  /** Mirakl has finished with it, one way or the other. */
  done: boolean;
  read: number | null;
  accepted: number | null;
  errors: number | null;
}

/** The statuses Mirakl uses for an import that is over. Anything else is still in progress. */
const IMPORT_FINISHED = ['COMPLETE', 'FAILED', 'CANCELLED', 'CANCELED'];

export function readJiniusImportReport(json: unknown): JiniusImportReport {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const status = String(body?.import_status ?? body?.status ?? '').toUpperCase();
  return {
    status: status || 'UNKNOWN',
    done: IMPORT_FINISHED.includes(status),
    read: num(body?.lines_read),
    accepted: num(body?.lines_in_success),
    errors: num(body?.lines_in_error),
  };
}

/**
 * What one offer write came to, in the words the person who pressed the button needs.
 *
 * Mirakl accepts an offer write and applies it afterwards, so "sent" and "done" are different
 * things and this says which it is. A queued import that we did not wait for is reported as sent
 * and not yet confirmed — never as success, because the next sync is what proves the figure.
 */
/**
 * The first real reasons out of a Mirakl error report.
 *
 * Mirakl answers a rejected import with a FILE, one row per refused line, and the reason is a column
 * in it. "Jinius rejected 1 of 1 line(s)" was true and useless - the reason was one fetch away and
 * nobody went and got it. The header row is dropped and the longest field of each row is taken,
 * because that is reliably the message wherever the operator put it.
 */
/** A row ending, however the operator's export wrote it. */
const NEWLINES = /\r?\n/;
/** Semicolon, tab, or a comma that is not inside quotes - operators use all three. */
const FIELD_SEPARATORS = /;|\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/;
const QUOTES = /^"|"$/g;

export function readJiniusErrorReport(text: string, max = 3): string[] {
  const rows = String(text ?? '').split(NEWLINES).map((r) => r.trim()).filter(Boolean);
  if (rows.length < 2) return [];
  return rows
    .slice(1, 1 + max)
    .map((row) => {
      const fields = row.split(FIELD_SEPARATORS).map((f) => f.replace(QUOTES, '').trim());
      return fields.sort((a, b) => b.length - a.length)[0] ?? '';
    })
    .filter(Boolean);
}

export function readJiniusPushOutcome(
  status: number,
  importId: number | null,
  report: JiniusImportReport | null,
  what: string,
  /** What Mirakl's error report said, where it was fetched. */
  reasons: readonly string[] = [],
): JiniusOutcome {
  if (status === 401 || status === 403) return { ok: false, message: `Jinius refused the offer write (${status}). The API key needs offer-write permission for this shop.` };
  if (status >= 400) return { ok: false, message: `Jinius answered ${status} to the offer write.` };
  if (importId == null) return { ok: false, message: 'Jinius accepted the request but returned no import id, so there is nothing to confirm it by.' };
  if (!report || !report.done) return { ok: true, message: `${what} sent to Jinius (import ${importId}) — queued there; the next sync confirms the figure.` };
  if (report.errors) {
    // Their own words first, if we have them: the count alone says nothing anybody can act on.
    const said = reasons.length ? ` ${reasons.join(' | ')}` : ' Their error report gave no reason we could read.';
    return { ok: false, message: `Jinius rejected ${report.errors} of ${report.read ?? '?'} line(s) in import ${importId}.${said}` };
  }
  if (report.status === 'FAILED' || report.status === 'CANCELLED' || report.status === 'CANCELED') return { ok: false, message: `Import ${importId} ended ${report.status}.` };
  return { ok: true, message: `${what} accepted by Jinius (import ${importId}).` };
}
