/**
 * Choosing a marketplace category without asking a person.
 *
 * Picking one was the last compulsory human step before a product could be listed, and it is a step
 * that scales badly: it is asked once per channel per product, and the answer is usually obvious.
 * Two things already know it and neither was being consulted automatically —
 *
 *   the MARKETPLACE, which ranks its own taxonomy against a title and is the authority on where
 *   things go on its own site; and
 *
 *   OUR OWN HISTORY, which is a person's judgement already made, repeatedly, for products of this
 *   same internal category.
 *
 * Where they agree there is nothing left to decide. Where they DISAGREE there genuinely is: either
 * this product differs from its siblings, or the title is misleading the marketplace, and both are
 * things a person settles in seconds and a rule settles wrongly. So that one case, and only that
 * one, is held back — with both answers shown and the disagreement named.
 *
 * A category is not a fact about the product, so this is not held to the two-sources rule that
 * governs specifics. It is a placement decision, the marketplace is its own authority, and it is
 * changed later by anyone who disagrees.
 *
 * PURE.
 */

export interface CategoryCandidate {
  id: string;
  name: string;
  /** The full path, where the marketplace gives one: "Home & Garden > Kitchen > Utensils". */
  path?: string | null;
  relevancy?: string | null;
}

/** What our own products of this kind were put in before. */
export interface CategoryHistory {
  id: string;
  name: string;
  /** How many of our products in the same internal category went there. */
  uses: number;
}

export type CategoryBasis = 'agreed' | 'marketplace' | 'history' | 'disagreement' | 'nothing';

export interface CategoryChoice {
  id: string | null;
  name: string | null;
  path: string | null;
  basis: CategoryBasis;
  /** Safe to apply without asking. False means a person should look. */
  confident: boolean;
  /** Why, in words somebody can check rather than a score they must trust. */
  because: string;
  /** The others, so a person disagreeing does not have to go looking. */
  alternatives: CategoryCandidate[];
}

/** How many of our own products must have gone somewhere before that alone is enough. */
const HISTORY_ENOUGH = 2;

const none = (because: string): CategoryChoice =>
  ({ id: null, name: null, path: null, basis: 'nothing', confident: false, because, alternatives: [] });

export function chooseCategory(
  marketplace: readonly CategoryCandidate[],
  history: CategoryHistory | null,
): CategoryChoice {
  const suggestions = marketplace.filter((c) => c.id && c.name);
  const top = suggestions[0] ?? null;
  const rest = suggestions.slice(1, 5);

  if (!top && !history) {
    return none('Neither the marketplace nor our own history suggests a category for this product.');
  }

  // The marketplace agreeing with what we chose before leaves nothing to decide.
  const agreed = history ? suggestions.find((c) => c.id === history.id) : null;
  if (agreed && history) {
    return {
      id: agreed.id,
      name: agreed.name,
      path: agreed.path ?? null,
      basis: 'agreed',
      confident: true,
      because: `The marketplace suggests it, and ${history.uses} of our products in the same internal category are already there.`,
      alternatives: suggestions.filter((c) => c.id !== agreed.id).slice(0, 4),
    };
  }

  /**
   * They disagree, and that is the one case worth a person.
   *
   * Either this product is not like its siblings, or its title is misleading the marketplace. Both
   * are settled in seconds by somebody who knows the product, and settled wrongly by any rule that
   * picks a winner - so neither is applied, and both are shown.
   */
  if (top && history && history.uses >= HISTORY_ENOUGH) {
    return {
      id: null,
      name: null,
      path: null,
      basis: 'disagreement',
      confident: false,
      because: `The marketplace suggests ${top.name}, but ${history.uses} of our products in the same internal `
        + `category are in ${history.name}. One of them is wrong for this product and it takes somebody who `
        + 'knows it to say which.',
      alternatives: [{ id: history.id, name: history.name, path: null }, ...suggestions.slice(0, 4)],
    };
  }

  if (top) {
    return {
      id: top.id,
      name: top.name,
      path: top.path ?? null,
      basis: 'marketplace',
      confident: true,
      because: history
        ? `The marketplace suggests it. Only ${history.uses} of our products sits in ${history.name}, which is too few to weigh against it.`
        : 'The marketplace suggests it, and we have not put a product of this kind there before.',
      alternatives: rest,
    };
  }

  // History alone: a person chose this before, more than once, for products of this same kind.
  if (history && history.uses >= HISTORY_ENOUGH) {
    return {
      id: history.id,
      name: history.name,
      path: null,
      basis: 'history',
      confident: true,
      because: `${history.uses} of our products in the same internal category are there, and the marketplace suggested nothing.`,
      alternatives: [],
    };
  }

  return none(
    history
      ? `Only one of our products sits in ${history.name} and the marketplace suggested nothing, which is too little to choose on.`
      : 'The marketplace suggested nothing for this product.',
  );
}
