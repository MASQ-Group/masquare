import { describe, expect, it } from 'vitest';
import { canonicalFactName } from './fact-names';
import { foldFindings, type SourceFinding } from './gather-rules';
import { classifyAspect, isPayloadEligible } from './provenance';

/**
 * The fold the shared store performs, on its own.
 *
 * ProductFactsService is a thin wrapper around this plus a read and a write, so the behaviour worth
 * pinning is the fold: that two channels' spellings become ONE fact, and that the sources each
 * channel found count together towards the rule that decides what may be published.
 */
const rememberLike = (existing: Record<string, any>, accepted: SourceFinding[], at: string) => {
  const canonical = accepted
    .map((f) => ({ ...f, field: canonicalFactName(f.field) }))
    .filter((f) => f.field && f.value.trim());
  const names = [...new Set(canonical.map((f) => f.field))];
  return foldFindings(existing, canonical, names, at);
};

const AT = '2026-09-25T10:00:00.000Z';

describe('facts kept once for every channel', () => {
  it('files two channels’ spellings of one fact under one name', () => {
    const first = rememberLike({}, [
      { field: 'Colour', value: 'Black', kind: 'manufacturer', url: 'https://sage.com/x' },
    ], AT);
    const second = rememberLike(first.records, [
      { field: 'General Product Information › Color', value: 'Black', kind: 'manufacturer', url: 'https://sage.com/x' },
    ], AT);
    expect(Object.keys(second.records)).toEqual(['colour']);
  });

  /**
   * The point of sharing, beyond not researching twice. A value one retailer vouched for is a
   * suggestion and stays held back. When eBay's research and OnBuy's research each found it once
   * from a DIFFERENT retailer, neither channel could see that two sources now agreed — so it stayed
   * a suggestion on both, forever, and a person had to confirm what the evidence already showed.
   */
  it('lets sources found for different channels meet the two-sources rule together', () => {
    const one = rememberLike({}, [
      { field: 'Capacity', value: '9.2 L', kind: 'web', url: 'https://retailer-a.com/p' },
    ], AT);
    expect(isPayloadEligible(one.records.capacity)).toBe(false);

    const two = rememberLike(one.records, [
      { field: 'Capacity', value: '9.2 L', kind: 'web', url: 'https://retailer-b.com/p' },
    ], AT);
    expect(classifyAspect(two.records.capacity)).toBe('agreement');
    expect(isPayloadEligible(two.records.capacity)).toBe(true);
  });

  /** One source saying it twice is still one source. The rule is about agreement, not repetition. */
  it('does not let one page corroborate itself', () => {
    const one = rememberLike({}, [{ field: 'Capacity', value: '9.2 L', kind: 'web', url: 'https://retailer-a.com/p' }], AT);
    const twice = rememberLike(one.records, [{ field: 'Capacity', value: '9.2 L', kind: 'web', url: 'https://retailer-a.com/p' }], AT);
    expect(isPayloadEligible(twice.records.capacity)).toBe(false);
  });

  it('keeps a finding that answers nothing out of the store', () => {
    const r = rememberLike({}, [{ field: '  ', value: 'x', kind: 'web' }, { field: 'Colour', value: '  ', kind: 'web' }], AT);
    expect(Object.keys(r.records)).toEqual([]);
  });
});
