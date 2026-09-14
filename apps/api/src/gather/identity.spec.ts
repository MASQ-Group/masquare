import { describe, expect, it } from 'vitest';
import { verifyIdentity, type SourceIdentity } from './identity';

const said = (over: Partial<SourceIdentity> = {}): SourceIdentity =>
  ({ brand: null, mpns: [], title: null, ...over });

describe('verifyIdentity', () => {
  /** The failure this exists for, written down so it cannot come back. */
  it('rejects the Panasonic-that-came-back-as-Marley', () => {
    const v = verifyIdentity(
      { brand: 'Panasonic', mpn: 'RP-HJE201E-K' },
      said({ brand: 'Marley', title: 'House of Marley Smile Jamaica Earphones' }),
    );
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toContain('Marley');
    expect(!v.ok && v.reason).toContain('Panasonic');
  });

  it('accepts the same product', () => {
    expect(verifyIdentity({ brand: 'Panasonic', mpn: 'RP-HJE201E-K' }, said({ brand: 'Panasonic', mpns: ['RP-HJE201E-K'] })))
      .toEqual({ ok: true, matchedOn: ['brand', 'mpn'] });
  });

  it('accepts a part number written with different punctuation', () => {
    expect(verifyIdentity({ brand: 'Panasonic', mpn: 'RP-HJE201E-K' }, said({ brand: 'Panasonic', mpns: ['RPHJE201EK'] })).ok)
      .toBe(true);
  });

  /** "Marley" and "House of Marley" are one company; the check is on whole words. */
  it('accepts a brand written longer or shorter', () => {
    expect(verifyIdentity({ brand: 'Marley', mpn: null }, said({ brand: 'House of Marley' })).ok).toBe(true);
    expect(verifyIdentity({ brand: 'Beurer GmbH', mpn: null }, said({ brand: 'Beurer' })).ok).toBe(true);
  });

  it('does not accept a brand that merely starts the same', () => {
    expect(verifyIdentity({ brand: 'Sony', mpn: null }, said({ brand: 'Sonya' })).ok).toBe(false);
  });

  /**
   * One character apart is what separates two variants of one product — exactly the pair a barcode
   * lookup confuses, and exactly the pair whose specifications differ.
   */
  it('rejects a part number that is nearly the same', () => {
    const v = verifyIdentity({ brand: 'Panasonic', mpn: 'RP-HJE201E-K' }, said({ brand: 'Panasonic', mpns: ['RP-HJE202E-K'] }));
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toContain('part number');
  });

  it('accepts when any one of several part numbers matches', () => {
    expect(verifyIdentity({ brand: 'Panasonic', mpn: 'RP-HJE201E-K' }, said({ mpns: ['XYZ', 'RP-HJE201E-K'] })))
      .toEqual({ ok: true, matchedOn: ['mpn'] });
  });

  describe('when nothing can be checked', () => {
    /** The heart of it: failing to disagree is not agreement. */
    it('refuses a source that offers nothing to check against', () => {
      const v = verifyIdentity({ brand: 'Panasonic', mpn: 'RP-HJE201E-K' }, said({ title: 'Black Earphones' }));
      expect(v.ok).toBe(false);
      expect(!v.ok && v.reason).toContain('confirm');
    });

    it('refuses when WE hold nothing to check against either', () => {
      expect(verifyIdentity({ brand: null, mpn: null }, said({ brand: 'Panasonic', mpns: ['RP-HJE201E-K'] })).ok)
        .toBe(false);
    });

    it('is satisfied by a brand alone when there is no part number on either side', () => {
      expect(verifyIdentity({ brand: 'Panasonic', mpn: null }, said({ brand: 'Panasonic' })))
        .toEqual({ ok: true, matchedOn: ['brand'] });
    });

    it('is satisfied by a part number alone when the source names no brand', () => {
      expect(verifyIdentity({ brand: 'Panasonic', mpn: 'RP-HJE201E-K' }, said({ mpns: ['RP-HJE201E-K'] })))
        .toEqual({ ok: true, matchedOn: ['mpn'] });
    });
  });

  it('treats blank and whitespace as absent, not as a mismatch', () => {
    expect(verifyIdentity({ brand: 'Panasonic', mpn: '  ' }, said({ brand: 'Panasonic', mpns: ['', '  '] })))
      .toEqual({ ok: true, matchedOn: ['brand'] });
  });
});
