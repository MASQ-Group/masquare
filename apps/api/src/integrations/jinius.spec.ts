import { describe, expect, it } from 'vitest';
import {
  JINIUS_PATHS, jiniusBase, jiniusHeaders, jiniusOfferUpdateBody, jiniusUrl, jiniusUrlProblem, readJiniusImportId,
  readJiniusImportReport, readJiniusOffers, readJiniusPushOutcome, readJiniusTest,
} from './jinius';

describe('the Jinius (Mirakl) base URL', () => {
  it('takes the host however it was pasted', () => {
    expect(jiniusBase('https://shop.mirakl.net/')).toBe('https://shop.mirakl.net');
    expect(jiniusBase('https://shop.mirakl.net/api')).toBe('https://shop.mirakl.net');
    expect(jiniusBase(' https://shop.mirakl.net/api/ ')).toBe('https://shop.mirakl.net');
  });

  it('says what is wrong before a call is made', () => {
    expect(jiniusUrlProblem('')).toMatch(/No API base URL/);
    expect(jiniusUrlProblem('http://shop.mirakl.net')).toMatch(/https/);
    expect(jiniusUrlProblem('https://shop.mirakl.net')).toBeNull();
  });

  it('adds only the parameters that have a value', () => {
    expect(jiniusUrl('https://shop.mirakl.net/api', JINIUS_PATHS.offers, { max: 1, shop_id: null }))
      .toBe('https://shop.mirakl.net/api/offers?max=1');
    expect(jiniusUrl('https://shop.mirakl.net', JINIUS_PATHS.offers, { max: 1, shop_id: '4321' }))
      .toBe('https://shop.mirakl.net/api/offers?max=1&shop_id=4321');
  });

  /**
   * Mirakl documents a product lookup as `product_references=EAN|123,EAN|456`, pipe and comma as they
   * are. Encoding turns those into %7C and %2C, and a gateway that does not decode them answers 200
   * with nothing found — which reads as "they do not carry it" and is not.
   */
  it('can send a parameter exactly as documented, unencoded', () => {
    expect(jiniusUrl('https://shop.mirakl.net', '/api/products', { shop_id: '4321' }, { product_references: 'EAN|123,EAN|456' }))
      .toBe('https://shop.mirakl.net/api/products?shop_id=4321&product_references=EAN|123,EAN|456');
    // Encoded is still the default, so ordinary calls are unaffected.
    expect(jiniusUrl('https://shop.mirakl.net', '/api/products', { product_references: 'EAN|123' }))
      .toBe('https://shop.mirakl.net/api/products?product_references=EAN%7C123');
    expect(jiniusUrl('https://shop.mirakl.net', '/api/products', {}, { product_references: '  ' }))
      .toBe('https://shop.mirakl.net/api/products');
  });
});

describe('the Authorization header', () => {
  /** Mirakl takes the key raw; "Bearer <key>" is the classic first mistake and answers 401. */
  it('sends the key as it is, with no Bearer', () => {
    expect(jiniusHeaders(' key-123 ')).toEqual({ Authorization: 'key-123', Accept: 'application/json' });
  });
});

describe('what a connection test means', () => {
  it('reports a success with the shop and how many offers it holds', () => {
    expect(readJiniusTest(200, { total_count: 3, offers: [] }, '4321'))
      .toEqual({ ok: true, message: 'Connected to Jinius for shop 4321 — 3 offers on the shop.' });
    expect(readJiniusTest(200, { total_count: 1, offers: [] }).message).toContain('1 offer on the shop');
    expect(readJiniusTest(200, 'not json').message).toBe('Connected to Jinius.');
  });

  it('names what to change for each refusal', () => {
    expect(readJiniusTest(401, { message: 'Invalid API key' })).toMatchObject({ ok: false });
    expect(readJiniusTest(401, { message: 'Invalid API key' }).message).toContain('did not accept the API key');
    expect(readJiniusTest(403, {}).message).toContain('Shop ID');
    expect(readJiniusTest(404, {}).message).toContain('base URL');
    expect(readJiniusTest(429, {}).message).toContain('rate-limiting');
    expect(readJiniusTest(503, {}).message).toContain('server error');
  });

  it('passes Mirakl’s own words through, cut short', () => {
    expect(readJiniusTest(400, { message: 'shop_id must be an integer' }).message).toContain('shop_id must be an integer');
  });
});

describe('reading a page of offers', () => {
  /** OF21's documented fields, as Mirakl returns them. */
  const page = {
    total_count: 682,
    offers: [
      { offer_id: 11223, shop_sku: 'LAG-612676', product_sku: 'MP-99', product_title: 'Victorinox card wallet', quantity: 4, available_quantity: 4, price: 39.9, active: true, state_code: '11' },
      { offer_id: 11224, shop_sku: ' LE-83306 ', product_title: '  ', quantity: 0, price: 12, active: false },
      { offer_id: 11225, product_sku: 'MP-77', quantity: 1, price: 5 },
    ],
  };

  it('keeps the seller’s own SKU, the offer id, stock and price', () => {
    const { rows, totalCount } = readJiniusOffers(page);
    expect(totalCount).toBe(682);
    expect(rows[0]).toEqual({
      sku: 'LAG-612676', asin: null, externalId: '11223', title: 'Victorinox card wallet',
      quantity: 4, price: 39.9, currency: 'EUR', fulfilmentChannel: null, status: null, marketplace: null,
    });
  });

  /**
   * `status` means Amazon's buyability answer, and every reader treats a non-null value without
   * BUYABLE in it as "cannot be bought". Mirakl has no such field - `state_code` is the CONDITION of
   * the goods, "11" being new - and storing that here made all 690 live Jinius offers read as paused.
   */
  it('leaves the buyability field alone for a live offer, whatever condition the goods are in', () => {
    expect(readJiniusOffers(page).rows[0].status).toBeNull();
  });

  it('marks an offer that is not for sale, and trims what it was given', () => {
    const { rows } = readJiniusOffers(page);
    expect(rows[1]).toMatchObject({ sku: 'LE-83306', status: 'INACTIVE', title: null, quantity: 0 });
  });

  /**
   * An offer with no shop SKU of ours used to be dropped, which made it invisible here: not on the
   * product, not in any worklist, and unreachable by the stock push. It is kept under Mirakl's own
   * product sku instead - unlinked, which is a thing somebody can see and fix.
   */
  it('keeps an offer that carries no shop SKU, and counts it', () => {
    const { rows, skuless } = readJiniusOffers(page);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ sku: 'MP-77', quantity: 1 });
    expect(skuless).toBe(1);
  });

  /**
   * Mirakl sends both figures and they mean different things: `quantity` is what the seller set,
   * `available_quantity` is what is left to sell once Mirakl's holds come off - and the second is
   * what their portal shows and what a buyer can order. 65-16567828 read 3 here against 1 there
   * until this was fixed.
   */
  it('stores what can be sold, not what the offer was set to', () => {
    const answer = { offers: [{ shop_sku: 'A', quantity: 3, available_quantity: 1, price: 12.5 }] };
    const { rows, heldBack } = readJiniusOffers(answer);
    expect(rows[0].quantity).toBe(1);
    expect(heldBack).toBe(1);
  });

  it('uses the only figure there is when the operator sends one', () => {
    const { rows, heldBack } = readJiniusOffers({ offers: [{ shop_sku: 'A', quantity: 7, price: 1 }] });
    expect(rows[0].quantity).toBe(7);
    expect(heldBack).toBe(0);
  });

  /** A genuine zero is a real state, and must not be read as "no figure given". */
  it('keeps a sellable zero', () => {
    expect(readJiniusOffers({ offers: [{ shop_sku: 'A', quantity: 4, available_quantity: 0 }] }).rows[0].quantity).toBe(0);
  });

  it('is safe on an answer that carries nothing', () => {
    expect(readJiniusOffers(null)).toEqual({ rows: [], totalCount: null, skuless: 0, heldBack: 0 });
    expect(readJiniusOffers({ offers: [] })).toEqual({ rows: [], totalCount: null, skuless: 0, heldBack: 0 });
  });
});


describe('changing an offer on Jinius', () => {
  /**
   * Mirakl leaves alone what an update does not mention. That is the whole reason only the changed
   * field is sent: a stock push that restated a price would undo a price someone had just set, and
   * the two go out from different parts of the platform.
   */
  it('sends only the field being changed', () => {
    expect(jiniusOfferUpdateBody([{ shopSku: 'IT49693', quantity: 4 }]).offers[0])
      .toEqual({ shop_sku: 'IT49693', update_delete: 'update', quantity: 4 });
    expect(jiniusOfferUpdateBody([{ shopSku: 'IT49693', price: 129.949 }]).offers[0])
      .toEqual({ shop_sku: 'IT49693', update_delete: 'update', price: 129.95 });
  });

  /** Mirakl counts whole units, and a negative quantity is not something we can mean. */
  it('sends a whole, never-negative quantity', () => {
    expect(jiniusOfferUpdateBody([{ shopSku: 'A', quantity: -3 }]).offers[0]).toMatchObject({ quantity: 0 });
    expect(jiniusOfferUpdateBody([{ shopSku: 'A', quantity: 2.6 }]).offers[0]).toMatchObject({ quantity: 3 });
  });

  it('reads the import id Mirakl answers with', () => {
    expect(readJiniusImportId({ import_id: 4417 })).toBe(4417);
    expect(readJiniusImportId({})).toBeNull();
  });

  it('reads an import report, and whether Mirakl has finished with it', () => {
    expect(readJiniusImportReport({ import_status: 'COMPLETE', lines_read: 1, lines_in_success: 1, lines_in_error: 0 }))
      .toEqual({ status: 'COMPLETE', done: true, read: 1, accepted: 1, errors: 0 });
    expect(readJiniusImportReport({ import_status: 'RUNNING' }).done).toBe(false);
    expect(readJiniusImportReport(null).status).toBe('UNKNOWN');
  });
});

describe('what an offer write came to', () => {
  const done = (o: Partial<ReturnType<typeof readJiniusImportReport>> = {}) =>
    ({ status: 'COMPLETE', done: true, read: 1, accepted: 1, errors: 0, ...o });

  /**
   * Accepting is not succeeding. Mirakl queues the write and applies it afterwards, so a push we
   * did not wait for must not be reported as a finished change - the next sync is what proves it.
   */
  it('separates sent from done', () => {
    expect(readJiniusPushOutcome(200, 77, null, 'Quantity 4')).toMatchObject({ ok: true });
    expect(readJiniusPushOutcome(200, 77, null, 'Quantity 4').message).toContain('queued');
    expect(readJiniusPushOutcome(200, 77, done(), 'Quantity 4').message).toContain('accepted by Jinius');
  });

  it('calls a rejected line a failure, not a success', () => {
    const r = readJiniusPushOutcome(200, 77, done({ accepted: 0, errors: 1 }), 'Price 12.00');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('rejected 1');
    expect(readJiniusPushOutcome(200, 77, done({ status: 'FAILED', errors: 0 }), 'x').ok).toBe(false);
  });

  it('names a permission problem as one', () => {
    expect(readJiniusPushOutcome(403, null, null, 'x').message).toContain('offer-write permission');
    expect(readJiniusPushOutcome(500, null, null, 'x').ok).toBe(false);
    // Accepted with nothing to confirm it by is not something to report as done.
    expect(readJiniusPushOutcome(200, null, null, 'x').ok).toBe(false);
  });
});
