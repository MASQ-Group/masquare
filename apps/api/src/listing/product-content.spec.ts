import { describe, expect, it } from 'vitest';
import { canonicalFactName } from '../gather/fact-names';

/**
 * The fold that makes one brief out of several channels' field lists.
 *
 * ProductContentService.brief is mostly marketplace calls and a database read; the part worth
 * pinning is this — that a fact three channels ask for under three names becomes ONE thing to go and
 * find, naming all three, and that two genuinely different fields stay two.
 */
function unionFields(byChannel: readonly { channel: string; fields: string[] }[]) {
  const wanted = new Map<string, { fact: string; askedBy: { channel: string; name: string }[] }>();
  for (const c of byChannel) {
    for (const name of c.fields) {
      const key = canonicalFactName(name);
      if (!key) continue;
      const entry = wanted.get(key) ?? { fact: name, askedBy: [] };
      entry.askedBy.push({ channel: c.channel, name });
      wanted.set(key, entry);
    }
  }
  return [...wanted.values()].sort((a, b) => b.askedBy.length - a.askedBy.length);
}

describe('one brief for every channel', () => {
  it('asks once for a fact several channels want, and names them all', () => {
    const out = unionFields([
      { channel: 'ebay', fields: ['Colour', 'Item Weight', 'Blade Material'] },
      { channel: 'onbuy', fields: ['General Product Information › Color', 'Wattage'] },
    ]);
    const colour = out.find((w) => canonicalFactName(w.fact) === 'colour')!;
    expect(colour.askedBy.map((a) => a.channel)).toEqual(['ebay', 'onbuy']);
    // Each channel keeps the name it uses, so a finding can be reported back under either.
    expect(colour.askedBy.map((a) => a.name)).toEqual(['Colour', 'General Product Information › Color']);
  });

  /** Most-wanted first: a researcher spending one trip should spend it where it settles the most. */
  it('puts the facts that serve the most channels first', () => {
    const out = unionFields([
      { channel: 'ebay', fields: ['Blade Material', 'Colour'] },
      { channel: 'onbuy', fields: ['Colour'] },
      { channel: 'jinius', fields: ['Colour'] },
    ]);
    expect(canonicalFactName(out[0].fact)).toBe('colour');
    expect(out[0].askedBy).toHaveLength(3);
  });

  it('keeps two genuinely different fields apart', () => {
    const out = unionFields([{ channel: 'ebay', fields: ['Capacity', 'Volume'] }]);
    expect(out).toHaveLength(2);
  });
});
