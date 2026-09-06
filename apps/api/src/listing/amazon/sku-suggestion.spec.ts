import { describe, expect, it } from 'vitest';
import { suggestSku, MAX_SKU_LENGTH } from './sku-suggestion';

/**
 * Naming a listing so Amazon will accept it.
 *
 * From 5 Sep 2026: listing IT33136 on Amazon AU was refused with
 *
 *   100398 — SKU 'IT33136' already exists in other Amazon marketplace(s).
 *            Use a new SKU and resubmit your listing.
 *
 * The product genuinely was not on AU — Amazon confirmed it — so the platform was right to offer
 * the listing. What it could not know was that the same SKU was already live on AE, SA and SG, and
 * that Amazon treats a seller SKU as one identity across the whole account. The rejection arrived
 * only after the whole plan had been filled in.
 */
describe('suggesting a SKU Amazon will accept', () => {
  it('suggests nothing when the SKU is free', () => {
    // The ordinary case. Offering an alternative to a name that works would invite splitting one
    // product across two identities for no reason.
    expect(suggestSku('IT33136', 'AU', [])).toBeNull();
    expect(suggestSku('IT33136', 'AU', ['SOMETHING-ELSE'])).toBeNull();
  });

  it('suffixes with the marketplace when the SKU is taken', () => {
    // The real case: taken on AE, SA and SG; being listed on AU.
    expect(suggestSku('IT33136', 'AU', ['IT33136'])).toBe('IT33136-AU');
  });

  it('matches the SKU regardless of case', () => {
    // Amazon does not treat it33136 and IT33136 as different listings, so neither can we.
    expect(suggestSku('IT33136', 'AU', ['it33136'])).toBe('IT33136-AU');
    expect(suggestSku('it33136', 'au', ['IT33136'])).toBe('it33136-AU');
  });

  it('counts up when the suffixed name is taken too', () => {
    // Usually an earlier attempt. Counting on beats giving up.
    expect(suggestSku('IT33136', 'AU', ['IT33136', 'IT33136-AU'])).toBe('IT33136-AU-2');
    expect(suggestSku('IT33136', 'AU', ['IT33136', 'IT33136-AU', 'IT33136-AU-2'])).toBe('IT33136-AU-3');
  });

  it('never proposes a name that is itself taken', () => {
    // The property that matters: being rejected a second time, on a name we chose, would be worse
    // than never having suggested one.
    const taken = ['IT33136', 'IT33136-AU', 'IT33136-AU-2', 'IT33136-AU-3', 'IT33136-AU-4'];
    const out = suggestSku('IT33136', 'AU', taken);
    expect(out).not.toBeNull();
    expect(taken.map((t) => t.toUpperCase())).not.toContain(out!.toUpperCase());
  });

  it('gives up rather than loop forever', () => {
    // Twenty collisions on one stem is not a naming problem, it is a sign something else is wrong
    // and a person should look.
    const taken = ['IT33136', ...Array.from({ length: 25 }, (_, i) => (i === 0 ? 'IT33136-AU' : `IT33136-AU-${i + 1}`))];
    expect(suggestSku('IT33136', 'AU', taken)).toBeNull();
  });

  it('stays within Amazon’s 40-character SKU limit', () => {
    const long = 'A'.repeat(38); // 38 + "-AU" would be 41
    const out = suggestSku(long, 'AU', [long]);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
  });

  it('falls back to a counter when there is no marketplace to name it after', () => {
    // Nothing meaningful to say, so it does not invent a label that says nothing.
    expect(suggestSku('IT33136', '', ['IT33136'])).toBe('IT33136-2');
  });

  it('ignores blank and whitespace entries in what is taken', () => {
    expect(suggestSku('IT33136', 'AU', ['', '   ', 'IT33136'])).toBe('IT33136-AU');
  });

  it('has nothing to say about an empty SKU', () => {
    expect(suggestSku('', 'AU', ['IT33136'])).toBeNull();
    expect(suggestSku('   ', 'AU', ['IT33136'])).toBeNull();
  });
});
