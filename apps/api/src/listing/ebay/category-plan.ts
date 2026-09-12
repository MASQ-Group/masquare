/**
 * What a chosen eBay category still wants before a listing can be published.
 *
 * eBay decides compulsory aspects per LEAF category, and the list is discoverable only at runtime —
 * a category that demands "Capacity" says so nowhere until it refuses the publish. So the answer is
 * assembled from what the Taxonomy API returned and what the product already carries, and the point
 * of doing it here is that `preview` and `publish` then cannot disagree about it.
 *
 * PURE: every fact is supplied. No fetching, no database.
 */

export interface CategoryAspect {
  name: string;
  required: boolean;
  /** SELECTION_ONLY means a value not on eBay's list is refused. */
  mode?: string | null;
  values?: string[];
}

/** Aspects the product already answers without anybody typing anything. */
export interface ProductAspectFacts {
  brand?: string | null;
  mpn?: string | null;
}

export type AspectSource = 'plan' | 'brand' | 'mpn' | 'model-from-mpn';

export interface ResolvedAspect {
  name: string;
  value: string | null;
  required: boolean;
  source: AspectSource | null;
  /** Set when a value exists but eBay will not accept it, so the form can say which and why. */
  rejectedBecause?: string;
}

/**
 * Marry the category's demands to what we hold.
 *
 * Brand and MPN come off the product because they always mean the same thing; everything else has
 * to be chosen per category and lives on the plan. `Model` is filled from the manufacturer part
 * number for the same reason `offer-payload` does it — for the products sold here the MPN IS the
 * model, and categories that want something else say so and a planned value wins.
 */
export function resolveAspects(
  categoryAspects: readonly CategoryAspect[],
  planned: Readonly<Record<string, string>>,
  facts: ProductAspectFacts,
): ResolvedAspect[] {
  return categoryAspects.map((a) => {
    const fromPlan = planned[a.name]?.trim();
    let value: string | null = null;
    let source: AspectSource | null = null;

    if (fromPlan) { value = fromPlan; source = 'plan'; }
    else if (/^brand$/i.test(a.name) && facts.brand?.trim()) { value = facts.brand.trim(); source = 'brand'; }
    else if (/^mpn$/i.test(a.name) && facts.mpn?.trim()) { value = facts.mpn.trim(); source = 'mpn'; }
    else if (/^model$/i.test(a.name) && facts.mpn?.trim()) { value = facts.mpn.trim(); source = 'model-from-mpn'; }

    /**
     * A SELECTION_ONLY aspect refuses anything off its list, so a value we are confident about can
     * still be wrong. Saying which — rather than sending it and reading eBay's refusal — is the
     * difference between a form somebody can finish and one that fails on submit.
     */
    if (value && a.mode === 'SELECTION_ONLY' && a.values?.length) {
      const accepted = a.values.find((v) => v.toLowerCase() === value!.toLowerCase());
      if (!accepted) {
        return { name: a.name, value, required: a.required, source, rejectedBecause: 'not one of the values eBay accepts here' };
      }
      // Use eBay's own spelling, so casing cannot be the thing that fails.
      value = accepted;
    }

    return { name: a.name, value, required: a.required, source };
  });
}

/** Required aspects with nothing usable behind them — the to-do list, shortest path to publishable. */
export function missingAspects(resolved: readonly ResolvedAspect[]): string[] {
  return resolved.filter((a) => a.required && (!a.value || a.rejectedBecause)).map((a) => a.name);
}

/** Only what should travel to eBay: answered, accepted, and not empty. */
export function aspectsForPayload(resolved: readonly ResolvedAspect[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of resolved) {
    if (!a.value || a.rejectedBecause) continue;
    out[a.name] = [a.value];
  }
  return out;
}
