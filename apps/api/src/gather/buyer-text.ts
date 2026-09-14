/**
 * What may be written into text a buyer reads.
 *
 * The description and feature lines are the only content here that goes in front of a customer, and
 * they are written by a researcher working from web pages. Three things must never reach a listing,
 * and none of them is a matter of taste:
 *
 *   - OUR INTERNAL SKU. `3G-RP-HJE201E-K-FOC` means something to the warehouse and nothing to a
 *     buyer; printed on a listing it is at best confusing and at worst tells a competitor how the
 *     catalogue is organised. Stated as a standing rule by the business.
 *   - CONTACT DETAILS AND LINKS. eBay forbids them in descriptions — an email address, a phone
 *     number or a link to another shop can get a listing removed.
 *   - MARKUP. The template escapes everything, so a stray tag would be printed at the buyer rather
 *     than rendered; better to refuse it and have it rewritten as prose.
 *
 * Refuses rather than silently cleans. A sentence quietly stripped of half its words reads as
 * gibberish on a live listing, and nobody would know which step did it.
 *
 * PURE.
 */

export interface BuyerTextProblem { where: string; problem: string }

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/i;
/** Seven or more digits, allowing the spaces and brackets people write numbers with. */
const PHONE = /(?:\+?\d[\d\s()-]{6,}\d)/;
const TAG = /<[a-z/!][^>]*>/i;

export const TEXT_LIMITS = { intro: 3000, feature: 240, features: 12 } as const;

/**
 * @param forbiddenCodes internal identifiers that must not appear — the product's own SKU and its
 *   aliases. The manufacturer part number is deliberately NOT one: buyers search for it.
 */
export function checkBuyerText(
  content: { intro?: string | null; features?: readonly string[] },
  forbiddenCodes: readonly string[],
): BuyerTextProblem[] {
  const problems: BuyerTextProblem[] = [];

  const check = (where: string, text: string) => {
    if (TAG.test(text)) problems.push({ where, problem: 'contains HTML — write plain prose, the platform does the formatting' });
    if (EMAIL.test(text)) problems.push({ where, problem: 'contains an email address, which eBay does not allow in a description' });
    if (URL_LIKE.test(text)) problems.push({ where, problem: 'contains a web address, which eBay does not allow in a description' });
    if (PHONE.test(text)) problems.push({ where, problem: 'contains what looks like a phone number, which eBay does not allow in a description' });

    for (const code of forbiddenCodes) {
      const wanted = code.trim();
      // Short codes would match by accident inside ordinary words and model numbers.
      if (wanted.length < 4) continue;
      if (text.toLowerCase().includes(wanted.toLowerCase())) {
        problems.push({ where, problem: `contains our internal SKU "${wanted}", which means nothing to a buyer` });
      }
    }
  };

  const intro = content.intro?.trim() ?? '';
  if (intro) {
    if (intro.length > TEXT_LIMITS.intro) problems.push({ where: 'description', problem: `is longer than ${TEXT_LIMITS.intro} characters` });
    check('description', intro);
  }

  const features = content.features ?? [];
  if (features.length > TEXT_LIMITS.features) {
    problems.push({ where: 'features', problem: `has more than ${TEXT_LIMITS.features} lines; keep the ones that sell the product` });
  }
  features.forEach((f, i) => {
    const line = f?.trim() ?? '';
    if (!line) return;
    if (line.length > TEXT_LIMITS.feature) problems.push({ where: `feature ${i + 1}`, problem: `is longer than ${TEXT_LIMITS.feature} characters` });
    check(`feature ${i + 1}`, line);
  });

  return problems;
}
