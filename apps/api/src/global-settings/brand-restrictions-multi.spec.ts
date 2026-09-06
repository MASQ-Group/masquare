import { describe, expect, it } from 'vitest';

/**
 * Recording one brand letter against several channels at once.
 *
 * A brand writes once and names four marketplaces. The interesting part is not the loop but what
 * happens to a selection that is not quite clean: duplicates, an "all marketplaces" option clicked
 * beside a specific one, casing that differs from the stored form.
 *
 * The normalise-and-dedupe step is restated here as the function it is, because a duplicate that
 * reaches the database collides on the unique key and loses the whole submission — over a
 * duplicate the person never meant to create.
 */
function normalise(
  requested: Array<{ channelType: string; marketplace?: string | null }>,
): Array<{ channelType: string; marketplace: string }> {
  const seen = new Map<string, { channelType: string; marketplace: string }>();
  for (const c of requested) {
    const channelType = (c.channelType ?? '').trim().toLowerCase();
    if (!channelType) continue;
    const marketplace = (c.marketplace ?? '').trim().toUpperCase();
    seen.set(`${channelType}|${marketplace}`, { channelType, marketplace });
  }
  return [...seen.values()];
}

describe('choosing several channels for one brand', () => {
  it('keeps each distinct marketplace', () => {
    expect(normalise([
      { channelType: 'amazon', marketplace: 'US' },
      { channelType: 'amazon', marketplace: 'CA' },
      { channelType: 'ebay', marketplace: 'GB' },
    ])).toHaveLength(3);
  });

  it('collapses the same channel picked twice', () => {
    // Two rows for one pair collide on the unique key and would lose the entire submission.
    expect(normalise([
      { channelType: 'amazon', marketplace: 'US' },
      { channelType: 'amazon', marketplace: 'US' },
    ])).toEqual([{ channelType: 'amazon', marketplace: 'US' }]);
  });

  it('collapses across casing and stray spaces', () => {
    // The picker sends normalised values, but the endpoint is reachable directly and an import
    // could send anything.
    expect(normalise([
      { channelType: 'Amazon', marketplace: 'us' },
      { channelType: ' amazon ', marketplace: ' US ' },
    ])).toEqual([{ channelType: 'amazon', marketplace: 'US' }]);
  });

  it('treats a whole-channel restriction as its own thing, not a duplicate', () => {
    // "Not on eBay at all" and "not on eBay GB" are different claims — the first is bigger — so
    // both are kept and the more specific one wins at read time.
    expect(normalise([
      { channelType: 'ebay', marketplace: '' },
      { channelType: 'ebay', marketplace: 'GB' },
    ])).toHaveLength(2);
  });

  it('reads a missing marketplace as the whole channel rather than dropping the row', () => {
    expect(normalise([{ channelType: 'onbuy' }])).toEqual([{ channelType: 'onbuy', marketplace: '' }]);
    expect(normalise([{ channelType: 'onbuy', marketplace: null }])).toEqual([{ channelType: 'onbuy', marketplace: '' }]);
  });

  it('ignores an entry with no channel at all', () => {
    // A blank row must not become a restriction on everything.
    expect(normalise([{ channelType: '', marketplace: 'US' }])).toEqual([]);
    expect(normalise([{ channelType: '   ', marketplace: 'US' }])).toEqual([]);
  });

  it('produces nothing from nothing, so the caller refuses rather than saving an empty rule', () => {
    expect(normalise([])).toEqual([]);
  });
});
