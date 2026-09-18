import { describe, expect, it } from 'vitest';
import { MOST_RECIPIENTS, recipientsFor, reviewRecipients } from './alert-recipients';

describe('reviewRecipients', () => {
  it('keeps ordinary addresses, tidied', () => {
    const { addresses, problems } = reviewRecipients([' Shipments@masquare.eu ', 'ops@example.com']);
    expect(addresses).toEqual(['shipments@masquare.eu', 'ops@example.com']);
    expect(problems).toEqual([]);
  });

  it('drops blank rows without complaining — that is a list mid-edit', () => {
    expect(reviewRecipients(['a@b.com', '', '   '])).toEqual({ addresses: ['a@b.com'], problems: [] });
  });

  it('drops repeats, however they were capitalised', () => {
    expect(reviewRecipients(['A@B.com', 'a@b.com']).addresses).toEqual(['a@b.com']);
  });

  it('refuses what is not an address, and says so about that one', () => {
    const { addresses, problems } = reviewRecipients(['good@example.com', 'not an address']);
    expect(addresses).toEqual(['good@example.com']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not an address');
  });

  it('refuses a domain with no dot, and a local part with no domain', () => {
    expect(reviewRecipients(['someone@localhost']).problems).toHaveLength(1);
    expect(reviewRecipients(['someone']).problems).toHaveLength(1);
    expect(reviewRecipients(['@example.com']).problems).toHaveLength(1);
  });

  it('refuses anything that would end the header and start another', () => {
    // A shipment email carries a customer's address and what is in their boxes. A second header
    // smuggled through this field is how that reaches somebody who was never meant to see it.
    for (const nasty of [
      'a@b.com\nBcc: thief@example.com',
      'a@b.com\r\nBcc: thief@example.com',
      'a@b.com, thief@example.com',
      'a@b.com; thief@example.com',
      'Ops <a@b.com>',
    ]) {
      const { addresses, problems } = reviewRecipients([nasty]);
      expect(addresses, nasty).toEqual([]);
      expect(problems, nasty).toHaveLength(1);
    }
  });

  it('keeps the good ones when one entry is bad', () => {
    const { addresses, problems } = reviewRecipients(['fine@example.com', 'rubbish', 'also.fine@example.com']);
    expect(addresses).toEqual(['fine@example.com', 'also.fine@example.com']);
    expect(problems).toHaveLength(1);
  });

  it('refuses a list long enough to be a distribution group', () => {
    const many = Array.from({ length: MOST_RECIPIENTS + 1 }, (_, i) => `p${i}@example.com`);
    expect(reviewRecipients(many).problems.join(' ')).toContain('group address');
  });

  it('treats anything that is not a list as an empty one', () => {
    expect(reviewRecipients(undefined)).toEqual({ addresses: [], problems: [] });
    expect(reviewRecipients(null)).toEqual({ addresses: [], problems: [] });
    expect(reviewRecipients('a@b.com')).toEqual({ addresses: [], problems: [] });
  });
});

describe('recipientsFor', () => {
  it('puts the named user first, then the extras', () => {
    expect(recipientsFor('named@masquare.eu', ['ops@masquare.eu'])).toEqual(['named@masquare.eu', 'ops@masquare.eu']);
  });

  it('never tells the same address twice', () => {
    // The person named in settings is very often the first address somebody adds as well.
    expect(recipientsFor('named@masquare.eu', ['NAMED@masquare.eu', 'ops@masquare.eu']))
      .toEqual(['named@masquare.eu', 'ops@masquare.eu']);
  });

  it('works with only extras, or only a named user', () => {
    expect(recipientsFor(null, ['ops@masquare.eu'])).toEqual(['ops@masquare.eu']);
    expect(recipientsFor('named@masquare.eu', [])).toEqual(['named@masquare.eu']);
  });

  it('is empty when nobody is set — and nothing is sent', () => {
    expect(recipientsFor(null, [])).toEqual([]);
    expect(recipientsFor('', [])).toEqual([]);
  });
});
