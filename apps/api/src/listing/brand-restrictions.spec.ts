import { describe, expect, it } from 'vitest';
import { restrictionFor, restrictionReason, type BrandRestriction } from './brand-restrictions';

/**
 * A brand telling us not to sell them somewhere.
 *
 * Separate from Amazon's own gating on purpose. Amazon may take the listing quite happily and the
 * restriction still stands, because it arrived as a letter rather than as an API refusal. Someone
 * seeing "restricted" needs to know WHICH kind, because the remedies differ: one is an approval
 * request to Amazon, the other is a conversation with the brand.
 *
 * Never a block, in either direction. The person listing may know the letter was withdrawn.
 */
const r = (channelType: string, marketplace: string, note?: string): BrandRestriction =>
  ({ channelType, marketplace, note });

describe('brand channel restrictions', () => {
  it('matches the named marketplace', () => {
    // Beurer: not on Amazon US or CA.
    const rules = [r('amazon', 'US'), r('amazon', 'CA')];
    expect(restrictionFor({ channelType: 'amazon', marketplace: 'US' }, rules)).toBeTruthy();
    expect(restrictionFor({ channelType: 'amazon', marketplace: 'CA' }, rules)).toBeTruthy();
  });

  it('leaves the marketplaces that were not named alone', () => {
    const rules = [r('amazon', 'US')];
    expect(restrictionFor({ channelType: 'amazon', marketplace: 'DE' }, rules)).toBeNull();
    expect(restrictionFor({ channelType: 'ebay', marketplace: 'US' }, rules)).toBeNull();
  });

  it('treats a blank marketplace as the whole channel', () => {
    // "Not on eBay at all" — one rule rather than one per market.
    const rules = [r('ebay', '')];
    expect(restrictionFor({ channelType: 'ebay', marketplace: 'GB' }, rules)).toBeTruthy();
    expect(restrictionFor({ channelType: 'ebay', marketplace: 'DE' }, rules)).toBeTruthy();
    expect(restrictionFor({ channelType: 'onbuy', marketplace: 'GB' }, rules)).toBeNull();
  });

  it('prefers the specific rule over the channel-wide one', () => {
    // Both exist: a note recorded against Amazon US is the one to show on Amazon US.
    const rules = [r('amazon', '', 'blanket'), r('amazon', 'US', 'letter of 4 Aug')];
    expect(restrictionFor({ channelType: 'amazon', marketplace: 'US' }, rules)?.note).toBe('letter of 4 Aug');
    expect(restrictionFor({ channelType: 'amazon', marketplace: 'DE' }, rules)?.note).toBe('blanket');
  });

  it('is not confused by case', () => {
    const rules = [r('Amazon', 'us')];
    expect(restrictionFor({ channelType: 'amazon', marketplace: 'US' }, rules)).toBeTruthy();
  });

  it('handles a channel with no marketplace', () => {
    // OnBuy is a single market; its integrations carry no ISO code.
    expect(restrictionFor({ channelType: 'onbuy', marketplace: null }, [r('onbuy', '')])).toBeTruthy();
    expect(restrictionFor({ channelType: 'onbuy', marketplace: null }, [r('onbuy', 'GB')])).toBeNull();
  });

  it('says nothing when there are no rules', () => {
    expect(restrictionFor({ channelType: 'amazon', marketplace: 'US' }, [])).toBeNull();
  });

  describe('the sentence a person reads', () => {
    it('names the brand, the channel and the letter', () => {
      const reason = restrictionReason('Beurer', { channelType: 'amazon', marketplace: 'US' }, r('amazon', 'US', 'letter of 4 Aug 2026'));
      expect(reason).toBe('Beurer has restricted sales on Amazon US — letter of 4 Aug 2026');
    });

    it('says which channel when the rule covers all of it', () => {
      const reason = restrictionReason('Beurer', { channelType: 'ebay', marketplace: 'GB' }, r('ebay', ''));
      expect(reason).toBe('Beurer has restricted sales on Ebay (all marketplaces)');
    });

    it('still reads properly without a brand name or a note', () => {
      expect(restrictionReason(null, { channelType: 'amazon', marketplace: 'US' }, r('amazon', 'US')))
        .toBe('The brand has restricted sales on Amazon US');
    });
  });
});
