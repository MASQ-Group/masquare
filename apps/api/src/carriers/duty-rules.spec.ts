import { describe, expect, it } from 'vitest';
import { customsValue, dutiesDue, firstMatchingRule, ruleMatches, ruleProblems, type DutyRule, type ShipmentFacts } from './duty-rules';

// Customs-style rates: one unit of the currency in euro.
const rates: Record<string, number> = { EUR: 1, GBP: 1.18, USD: 0.92 };
const rate = (c: string) => rates[c] ?? null;

describe('whether duties are due on arrival', () => {
  const uk = { mode: 'threshold' as const, threshold: 135, currency: 'GBP' };

  it('compares the goods against the threshold in euro, whatever each is priced in', () => {
    expect(dutiesDue(uk, { value: 200, currency: 'GBP' }, rate).due).toBe(true);
    expect(dutiesDue(uk, { value: 100, currency: 'GBP' }, rate).due).toBe(false);
    // €150 is £127 — within £135.
    expect(dutiesDue(uk, { value: 150, currency: 'EUR' }, rate).due).toBe(false);
    // €170 is £144 — above it.
    expect(dutiesDue(uk, { value: 170, currency: 'EUR' }, rate).due).toBe(true);
  });

  it('is due on everything at a threshold of zero, and never where the country charges nothing', () => {
    expect(dutiesDue({ mode: 'threshold', threshold: 0, currency: 'USD' }, { value: 1, currency: 'EUR' }, rate).due).toBe(true);
    expect(dutiesDue({ mode: 'none', threshold: null, currency: null }, { value: 9999, currency: 'EUR' }, rate).due).toBe(false);
  });

  it('is unknown — not a guess — where nobody set the country, or a rate or value is missing', () => {
    expect(dutiesDue({ mode: null, threshold: null, currency: null }, { value: 10, currency: 'EUR' }, rate).due).toBeNull();
    expect(dutiesDue(null, { value: 10, currency: 'EUR' }, rate).due).toBeNull();
    expect(dutiesDue(uk, { value: 10, currency: 'JPY' }, rate)).toEqual({ due: null, reason: 'no exchange rate for JPY' });
    expect(dutiesDue(uk, { value: null, currency: 'EUR' }, rate).due).toBeNull();
  });

  it('says why, so the screen can show it', () => {
    expect(dutiesDue(uk, { value: 200, currency: 'GBP' }, rate).reason).toBe('goods GBP 200.00 above the GBP 135.00 threshold');
  });
});

const rule = (over: Partial<DutyRule> = {}): DutyRule => ({
  id: 'r', name: 'Rule', sortOrder: 0, active: true, salesChannelId: null,
  destinationRelation: 'any', destinationRegion: 'any', dutiesDue: 'any', dutiesPaidBy: 'sender', ...over,
});

// eBay UK selling to a UK buyer, goods above £135.
const ukHome: ShipmentFacts = { salesChannelId: 'ebay-uk', channelHomeIso: 'GB', destinationIso: 'GB', destinationInEu: false, dutiesDue: true };

describe('the two rules as asked for', () => {
  const rules = [
    rule({ id: 'ddp', name: 'Home market export — DDP', sortOrder: 1, destinationRelation: 'channel_home', destinationRegion: 'non_eu', dutiesDue: 'yes', dutiesPaidBy: 'sender' }),
    rule({ id: 'dap', name: 'Cross-border export — DAP', sortOrder: 2, destinationRelation: 'not_channel_home', destinationRegion: 'non_eu', dutiesDue: 'yes', dutiesPaidBy: 'recipient' }),
  ];

  it('pre-fills DDP when the destination is the channel’s own country, outside the EU, with duties due', () => {
    expect(firstMatchingRule(rules, ukHome)?.id).toBe('ddp');
  });

  it('pre-fills DAP when the destination is some other country outside the EU, with duties due', () => {
    expect(firstMatchingRule(rules, { ...ukHome, destinationIso: 'US' })?.id).toBe('dap');
  });

  it('pre-fills nothing inside the EU or where no duties are due', () => {
    expect(firstMatchingRule(rules, { ...ukHome, destinationIso: 'DE', destinationInEu: true })).toBeNull();
    expect(firstMatchingRule(rules, { ...ukHome, dutiesDue: false })).toBeNull();
  });
});

describe('a condition on something unknown', () => {
  it('does not hold: a channel with no home country is neither home nor away', () => {
    const f = { ...ukHome, channelHomeIso: null };
    expect(ruleMatches(rule({ destinationRelation: 'channel_home' }), f)).toBe(false);
    expect(ruleMatches(rule({ destinationRelation: 'not_channel_home' }), f)).toBe(false);
    expect(ruleMatches(rule({ destinationRelation: 'any' }), f)).toBe(true);
  });

  it('does not hold: duties that could not be worked out are neither due nor not', () => {
    const f = { ...ukHome, dutiesDue: null };
    expect(ruleMatches(rule({ dutiesDue: 'yes' }), f)).toBe(false);
    expect(ruleMatches(rule({ dutiesDue: 'no' }), f)).toBe(false);
  });
});

describe('the order of rules', () => {
  it('applies the first by sort order, skipping inactive ones and other channels', () => {
    const rules = [
      rule({ id: 'b', sortOrder: 2, dutiesPaidBy: 'recipient' }),
      rule({ id: 'off', sortOrder: 0, active: false }),
      rule({ id: 'amazon', sortOrder: 1, salesChannelId: 'amazon-uk' }),
    ];
    expect(firstMatchingRule(rules, ukHome)?.id).toBe('b');
    expect(firstMatchingRule(rules, { ...ukHome, salesChannelId: 'amazon-uk' })?.id).toBe('amazon');
  });
});

describe('a rule as entered', () => {
  it('needs a name and an answer', () => {
    expect(ruleProblems({ name: ' ', dutiesPaidBy: 'x' })).toEqual(['A rule needs a name.', 'Choose who pays: DDP or DAP.']);
    expect(ruleProblems({ name: 'OK', dutiesPaidBy: 'sender', destinationRegion: 'mars' })).toEqual(['Unknown region condition.']);
    expect(ruleProblems({ name: 'OK', dutiesPaidBy: 'recipient' })).toEqual([]);
  });
});

describe('the value compared with a threshold', () => {
  const uk = { mode: 'threshold' as const, threshold: 135, currency: 'GBP' };

  it('is goods and shipping together, as customs judge it — an order under on goods alone can be over with its shipping', () => {
    // £125 of goods is within £135; with £15 of shipping it is £140, and duties are charged.
    expect(dutiesDue(uk, { value: 125, currency: 'GBP', label: 'goods' }, rate).due).toBe(false);
    const withShipping = dutiesDue(uk, { value: 140, currency: 'GBP', label: 'goods and shipping' }, rate);
    expect(withShipping).toEqual({ due: true, reason: 'goods and shipping GBP 140.00 above the GBP 135.00 threshold' });
  });
});

describe('the value customs judge a threshold on', () => {
  it('adds the shipping the buyer paid to the goods, across every line', () => {
    expect(customsValue([{ netSalesAmount: 100, shippingAmount: 10 }, { netSalesAmount: 25, shippingAmount: 5 }]))
      .toEqual({ value: 140, label: 'goods and shipping' });
  });

  it('is the goods alone where no shipping was charged', () => {
    expect(customsValue([{ netSalesAmount: 125, shippingAmount: null }])).toEqual({ value: 125, label: 'goods' });
  });

  it('is nothing where there is no value at all', () => {
    expect(customsValue([{ netSalesAmount: null, shippingAmount: null }]).value).toBeNull();
  });
});
