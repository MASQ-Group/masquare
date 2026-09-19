/**
 * Who pays duties and taxes on a FedEx shipment: the rules that pre-fill the answer.
 *
 * Two questions, kept apart because they have different owners:
 *
 *  1. Will duties and taxes be charged on arrival? A fact about the destination: each country says
 *     whether it charges nothing, or charges above a value threshold in its own currency. Compared
 *     here against the value customs judge it on — the goods plus the shipping, excluding VAT, as
 *     outside the EU the threshold is applied to the CIF value — both in euro at the customs rate
 *     of the month.
 *  2. Given that, who should pay? A business decision, written as an ordered list of rules. The first
 *     active rule whose every condition holds wins.
 *
 * The answer is a pre-fill. It is shown with the rule that produced it, and a person can change it.
 *
 * PURE.
 */

export type DutiesPaidBy = 'sender' | 'recipient';
export type DestinationRelation = 'any' | 'channel_home' | 'not_channel_home';
export type DestinationRegion = 'any' | 'eu' | 'non_eu';
export type DutiesDueCondition = 'any' | 'yes' | 'no';

export const DESTINATION_RELATIONS: DestinationRelation[] = ['any', 'channel_home', 'not_channel_home'];
export const DESTINATION_REGIONS: DestinationRegion[] = ['any', 'eu', 'non_eu'];
export const DUTIES_DUE_CONDITIONS: DutiesDueCondition[] = ['any', 'yes', 'no'];
export const DUTIES_PAID_BY: DutiesPaidBy[] = ['sender', 'recipient'];

/** A destination's import threshold, as the countries table holds it. */
export interface CountryDuty {
  mode: 'none' | 'threshold' | null;
  threshold: number | null;
  currency: string | null;
}

/**
 * Whether duties and taxes will be charged on arrival. Null where it cannot be told.
 *
 * `rateToEur` takes one unit of a currency to euro, or null where no rate is held. Unknown is its own
 * answer rather than a guess in either direction: a rule that asks "are duties due?" does not match
 * an unknown, so nothing is pre-filled on a fact nobody established.
 */
export function dutiesDue(
  country: CountryDuty | null,
  goods: { value: number | null; currency: string | null; label?: string },
  rateToEur: (currency: string) => number | null,
): { due: boolean | null; reason: string } {
  if (!country || !country.mode) return { due: null, reason: 'the destination has no import threshold set' };
  if (country.mode === 'none') return { due: false, reason: 'the destination charges no import duties' };

  const threshold = country.threshold ?? 0;
  if (threshold <= 0) return { due: true, reason: 'the destination charges import duties on every value' };

  if (goods.value == null || !goods.currency) return { due: null, reason: 'the goods have no value to compare' };
  const thresholdCurrency = (country.currency ?? 'EUR').toUpperCase();
  const goodsRate = rateToEur(goods.currency.toUpperCase());
  const thresholdRate = rateToEur(thresholdCurrency);
  if (goodsRate == null || thresholdRate == null) {
    return { due: null, reason: `no exchange rate for ${goodsRate == null ? goods.currency.toUpperCase() : thresholdCurrency}` };
  }

  const valueEur = goods.value * goodsRate;
  const thresholdEur = threshold * thresholdRate;
  const over = valueEur > thresholdEur;
  return {
    due: over,
    reason: `${goods.label ?? 'goods'} ${goods.currency.toUpperCase()} ${goods.value.toFixed(2)} ${over ? 'above' : 'within'} the ${thresholdCurrency} ${threshold.toFixed(2)} threshold`,
  };
}

/**
 * The value a threshold is judged on: the goods plus the shipping the buyer paid, excluding VAT.
 *
 * Outside the EU customs apply a threshold to the CIF value — cost, insurance and freight — so an
 * order under it on the goods alone is still charged once its shipping is added. Null where there is
 * nothing to compare.
 */
export function customsValue(lines: ReadonlyArray<{ netSalesAmount: number | null; shippingAmount: number | null }>): {
  value: number | null;
  label: 'goods' | 'goods and shipping';
} {
  const goods = lines.reduce((t, l) => t + (Number(l.netSalesAmount) || 0), 0);
  const shipping = lines.reduce((t, l) => t + (Number(l.shippingAmount) || 0), 0);
  const total = Math.round((goods + shipping) * 100) / 100;
  return { value: total > 0 ? total : null, label: shipping > 0 ? 'goods and shipping' : 'goods' };
}

/** What is known about one shipment, for the rules to test. */
export interface ShipmentFacts {
  salesChannelId: string | null;
  /** ISO-2 of the channel's home country, where the channel has one. */
  channelHomeIso: string | null;
  destinationIso: string | null;
  destinationInEu: boolean | null;
  dutiesDue: boolean | null;
}

export interface DutyRule {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  salesChannelId: string | null;
  destinationRelation: string;
  destinationRegion: string;
  dutiesDue: string;
  dutiesPaidBy: string;
}

/**
 * Whether one rule holds for these facts.
 *
 * A condition on something unknown does not hold — a rule about the channel's home market says
 * nothing about a channel with no home country, and a rule about duties being due says nothing when
 * that could not be worked out. Only "any" is satisfied by an unknown.
 */
export function ruleMatches(rule: DutyRule, f: ShipmentFacts): boolean {
  if (!rule.active) return false;
  if (rule.salesChannelId && rule.salesChannelId !== f.salesChannelId) return false;

  const dest = f.destinationIso?.toUpperCase() ?? null;
  const home = f.channelHomeIso?.toUpperCase() ?? null;
  if (rule.destinationRelation === 'channel_home' && !(dest && home && dest === home)) return false;
  if (rule.destinationRelation === 'not_channel_home' && !(dest && home && dest !== home)) return false;

  if (rule.destinationRegion === 'eu' && f.destinationInEu !== true) return false;
  if (rule.destinationRegion === 'non_eu' && f.destinationInEu !== false) return false;

  if (rule.dutiesDue === 'yes' && f.dutiesDue !== true) return false;
  if (rule.dutiesDue === 'no' && f.dutiesDue !== false) return false;

  return true;
}

/** The first rule that holds, in order, or null. */
export function firstMatchingRule<R extends DutyRule>(rules: readonly R[], facts: ShipmentFacts): R | null {
  const ordered = [...rules].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return ordered.find((r) => ruleMatches(r, facts)) ?? null;
}

/** Problems with a rule as entered, in words. Empty means it may be saved. */
export function ruleProblems(r: Partial<DutyRule>): string[] {
  const out: string[] = [];
  if (!String(r.name ?? '').trim()) out.push('A rule needs a name.');
  if (!DUTIES_PAID_BY.includes(r.dutiesPaidBy as DutiesPaidBy)) out.push('Choose who pays: DDP or DAP.');
  if (r.destinationRelation && !DESTINATION_RELATIONS.includes(r.destinationRelation as DestinationRelation)) out.push('Unknown destination condition.');
  if (r.destinationRegion && !DESTINATION_REGIONS.includes(r.destinationRegion as DestinationRegion)) out.push('Unknown region condition.');
  if (r.dutiesDue && !DUTIES_DUE_CONDITIONS.includes(r.dutiesDue as DutiesDueCondition)) out.push('Unknown duties condition.');
  return out;
}
