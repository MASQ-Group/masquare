/**
 * Did two sources say the same thing?
 *
 * The two-source rule lives or dies here. Amazon writes "1200 Watts", eBay writes "1200W", and a
 * plain string comparison calls that a disagreement — so a value both sources actually agree on gets
 * held back, and somebody confirms by hand what the rule was supposed to settle automatically.
 *
 * The opposite failure is worse and shapes every decision below: an eager normaliser that decides
 * "1200 W" and "1.2 kW" are the same thing has invented an agreement, and an invented agreement
 * publishes an unverified value. So nothing here converts, infers or rounds. It canonicalises
 * SPELLING — casing, spacing, thousands separators, trailing zeros, and a fixed vocabulary of unit
 * words — and stops. Two values that mean the same thing in different units do not agree; they go to
 * a person, which is the correct outcome for a machine that cannot read a datasheet.
 *
 * The vocabulary is deliberately a closed list. Every entry is a spelling of a unit, never a
 * conversion between units, and adding one is a decision somebody makes on purpose.
 *
 * PURE.
 */

/**
 * Spellings of the same unit. Prefixed units are absent on purpose: `kw` is not in the table, so
 * it never collapses into `w` and can never silently agree with it.
 */
const UNIT_SPELLINGS: Array<[RegExp, string]> = [
  [/\b(?:watts?|w)\b/g, 'w'],
  [/\b(?:volts?|v)\b/g, 'v'],
  [/\b(?:amps?|amperes?|a)\b/g, 'a'],
  [/\b(?:hertz|hz)\b/g, 'hz'],
  [/\b(?:kilograms?|kilos?|kgs?)\b/g, 'kg'],
  [/\b(?:grams?|gr?s?)\b/g, 'g'],
  [/\b(?:milligrams?|mg)\b/g, 'mg'],
  [/\b(?:millimet(?:re|er)s?|mm)\b/g, 'mm'],
  [/\b(?:centimet(?:re|er)s?|cms?)\b/g, 'cm'],
  [/\b(?:met(?:re|er)s?|m)\b/g, 'm'],
  [/\b(?:inch(?:es)?|in)\b/g, 'in'],
  [/\b(?:millilit(?:re|er)s?|ml)\b/g, 'ml'],
  [/\b(?:lit(?:re|er)s?|ltr?s?|l)\b/g, 'l'],
  [/\b(?:degrees?|deg)\b/g, '°'],
  [/\b(?:minutes?|mins?)\b/g, 'min'],
  [/\b(?:seconds?|secs?)\b/g, 's'],
  [/\b(?:hours?|hrs?|h)\b/g, 'h'],
];

/** British and American spellings of the same thing. Spelling only — never a synonym for a value. */
const WORD_SPELLINGS: Array<[RegExp, string]> = [
  [/\bcolou?r\b/g, 'color'],
  [/\bgre[ay]\b/g, 'gray'],
  [/\baluminium\b/g, 'aluminum'],
  [/\bfibre\b/g, 'fiber'],
];

/**
 * The comparison form of a value. Never stored, never shown, never sent — only compared.
 *
 * What a source actually wrote is kept verbatim in its origin, because the evidence is the point.
 * This is a key for asking "are these the same answer", nothing more.
 */
export function comparable(raw: string): string {
  let s = raw.normalize('NFKC').toLowerCase().trim();

  // Typographic characters that mean the same as their ASCII forms.
  s = s.replace(/[   ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/[×✕]/g, 'x');

  // Thousands separators, only between digits so a decimal comma survives to be handled below.
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  s = s.replace(/\s+/g, ' ');

  for (const [pattern, canon] of WORD_SPELLINGS) s = s.replace(pattern, canon);
  for (const [pattern, canon] of UNIT_SPELLINGS) s = s.replace(pattern, canon);

  /**
   * 1.50 and 1.5 and 1.500 are one number written three ways. Re-emitted from the parsed value so
   * the comparison does not turn a trailing zero into a disagreement.
   */
  s = s.replace(/\d+\.\d+/g, (m) => String(parseFloat(m)));

  // "1200 w" and "1200w" are the same; the space is typography.
  s = s.replace(/(\d)\s+(?=[a-z°])/g, '$1');
  // As is the space around a dimension separator.
  s = s.replace(/\s*x\s*/g, 'x');

  return s.replace(/[.,;:!]+$/, '').trim();
}

/**
 * Do these two answers say the same thing?
 *
 * Blank never agrees with anything, including another blank. "Both sources found nothing" is not
 * two sources agreeing on a value — it is no evidence at all, and treating it as agreement would
 * write an empty item specific with a confident provenance behind it.
 */
export function valuesAgree(a: string, b: string): boolean {
  const ca = comparable(a);
  const cb = comparable(b);
  return ca.length > 0 && ca === cb;
}

/**
 * Group values that say the same thing, keeping the first spelling of each.
 *
 * The first spelling wins rather than the most common one: source order is priority order, so the
 * value stored is the one the most trusted source that mentioned it actually wrote. A datasheet's
 * "1200 W" should not be restyled into Amazon's "1200 Watts" because Amazon repeated itself.
 */
export function groupByMeaning<T>(items: readonly T[], valueOf: (t: T) => string): Array<{ value: string; items: T[] }> {
  const groups: Array<{ key: string; value: string; items: T[] }> = [];
  for (const item of items) {
    const raw = valueOf(item);
    const key = comparable(raw);
    if (!key) continue;
    const found = groups.find((g) => g.key === key);
    if (found) found.items.push(item);
    else groups.push({ key, value: raw.trim(), items: [item] });
  }
  return groups.map(({ value, items }) => ({ value, items }));
}
