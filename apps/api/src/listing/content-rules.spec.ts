import { describe, expect, it } from 'vitest';
import { channelContentState, contentRulesFor, contentSummary } from './content-rules';
import { readProductCopy } from '../gather/product-copy';

const COPY = readProductCopy({
  title: { brand: 'Sage', model: 'BES875UK', whatItIs: 'Espresso Machine', attributes: ['Stainless Steel'] },
  paragraphs: ['Pulls a true espresso.'],
});
const EMPTY = readProductCopy(null);

describe('what each channel wants of our words', () => {
  /**
   * Amazon shows its own catalogue page whatever we write, so a title for it is not a shorter title
   * — it is a field nobody reads. Saying "no title" about it would be a blocker nobody can clear.
   */
  it('asks nothing of a channel that never shows our words', () => {
    const s = channelContentState({ channelType: 'amazon' }, EMPTY)!;
    expect(s.title).toBeNull();
    expect(s.description).toBeNull();
    expect(s.blockers).toEqual([]);
  });

  it('says where a title came from, and holds it to the channel’s limit', () => {
    const shared = channelContentState({ channelType: 'ebay', categoryRef: '123' }, COPY)!;
    expect(shared.title).toMatchObject({ source: 'shared', value: 'Sage BES875UK Espresso Machine Stainless Steel', fits: true, limit: 80 });

    const own = channelContentState({ channelType: 'ebay', categoryRef: '123', ownTitle: 'Written for eBay' }, COPY)!;
    expect(own.title).toMatchObject({ source: 'channel', value: 'Written for eBay' });
  });

  /** Over the limit is refused by the marketplace, so it is a blocker here rather than a note. */
  it('treats a title the channel would refuse as a blocker', () => {
    const long = readProductCopy({ title: { brand: 'A'.repeat(60), model: 'B'.repeat(40), whatItIs: 'Kettle' } });
    const s = channelContentState({ channelType: 'ebay', categoryRef: '1' }, long)!;
    expect(s.title!.fits).toBe(false);
    expect(s.blockers[0]).toContain('eBay allows 80');
  });

  it('names the category a channel is waiting on', () => {
    const s = channelContentState({ channelType: 'onbuy' }, COPY)!;
    expect(s.blockers).toContain('No OnBuy category chosen — it decides which fields exist.');
    expect(channelContentState({ channelType: 'onbuy', categoryRef: '9', categoryName: 'Kettles' }, COPY)!.blockers).toEqual([]);
  });

  it('says plainly when there is nothing to say at all', () => {
    const s = channelContentState({ channelType: 'onbuy', categoryRef: '9' }, EMPTY)!;
    expect(s.blockers).toEqual([
      'No title — nothing written here and nothing to assemble one from.',
      'No description — nothing written here and no paragraphs to render.',
    ]);
  });

  it('is silent about a channel it has never been taught', () => {
    expect(channelContentState({ channelType: 'etsy' }, COPY)).toBeNull();
    expect(contentRulesFor('etsy')).toBeNull();
  });
});

describe('the one sentence for the product', () => {
  /** Named rather than counted: "2 channels need something" makes a person open all of them. */
  it('names the channels still waiting', () => {
    const states = [
      channelContentState({ channelType: 'ebay', categoryRef: '1' }, COPY)!,
      channelContentState({ channelType: 'onbuy' }, COPY)!,
    ];
    expect(contentSummary(states)).toBe('Ready on 1 of 2. Waiting: OnBuy.');
  });

  it('says so when everything is ready', () => {
    const states = [channelContentState({ channelType: 'ebay', categoryRef: '1' }, COPY)!];
    expect(contentSummary(states)).toBe('Ready on all 1 channels.');
    expect(contentSummary([])).toContain('No channel here');
  });
});
