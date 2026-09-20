import { describe, expect, it } from 'vitest';
import { JINIUS_PATHS, jiniusBase, jiniusHeaders, jiniusUrl, jiniusUrlProblem, readJiniusTest } from './jinius';

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
