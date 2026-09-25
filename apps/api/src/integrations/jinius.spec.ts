import { describe, expect, it } from 'vitest';
import { JINIUS_PATHS, jiniusBase, jiniusHeaders, jiniusUrl, jiniusUrlProblem, readJiniusOffers, readJiniusTest } from './jinius';

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
      { offer_id: 11223, shop_sku: 'LAG-612676', product_sku: 'MP-99', product_title: 'Victorinox card wallet', quantity: 4, price: 39.9, active: true, state_code: '11' },
      { offer_id: 11224, shop_sku: ' LE-83306 ', product_title: '  ', quantity: 0, price: 12, active: false },
      { offer_id: 11225, product_sku: 'MP-77', quantity: 1, price: 5 },
    ],
  };

  it('keeps the seller’s own SKU, the offer id, stock and price', () => {
    const { rows, totalCount } = readJiniusOffers(page);
    expect(totalCount).toBe(682);
    expect(rows[0]).toEqual({
      sku: 'LAG-612676', asin: null, externalId: '11223', title: 'Victorinox card wallet',
      quantity: 4, price: 39.9, currency: 'EUR', fulfilmentChannel: null, status: '11', marketplace: null,
    });
  });

  it('marks an offer that is not for sale, and trims what it was given', () => {
    const { rows } = readJiniusOffers(page);
    expect(rows[1]).toMatchObject({ sku: 'LE-83306', status: 'INACTIVE', title: null, quantity: 0 });
  });

  /** product_sku is the marketplace's code and matches no product here. */
  it('drops an offer with no shop SKU rather than storing one nobody can look up', () => {
    expect(readJiniusOffers(page).rows).toHaveLength(2);
  });

  it('is safe on an answer that carries nothing', () => {
    expect(readJiniusOffers(null)).toEqual({ rows: [], totalCount: null });
    expect(readJiniusOffers({ offers: [] })).toEqual({ rows: [], totalCount: null });
  });
});
