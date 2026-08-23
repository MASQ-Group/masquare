// Do we hold everything this channel needs before a listing can be prepared?
//
// The other half of the answer, next to eligibility. Everything here is fixable by typing, which
// is why it reads as a to-do list rather than a refusal: "needs a category and two aspects" is a
// task, "blocked, 230V on 120V mains" is not.
//
// PURE: the caller supplies the facts. Requirements are declared as data so that a channel gaining
// a field is one line here rather than a new branch somewhere in a service.

export interface ListingFacts {
  /** From the product. */
  ean: string | null;
  upc: string | null;
  ebayTitle: string | null;
  descriptionHtml: string | null;
  imageCount: number;
  packageWeightKg: number | null;
  hasPackageDimensions: boolean;
  /** From the plan for this channel. */
  categoryRef: string | null;
  condition: string | null;
  handlingTimeDays: number | null;
  deliveryTemplate: string | null;
  /** Category-specific values the channel demands, and which of them are still empty. */
  missingRequiredAspects: string[];
}

export interface Requirement {
  key: string;
  /** Written as the thing to go and do, not as the name of a column. */
  label: string;
  satisfied: (f: ListingFacts) => boolean;
}

const hasText = (v: string | null | undefined): boolean => !!v && v.trim().length > 0;

/** An identifier is how a catalogue channel finds the product it should attach our offer to. */
const IDENTIFIER: Requirement = {
  key: 'identifier',
  label: 'An EAN or UPC to match the marketplace catalogue',
  satisfied: (f) => hasText(f.ean) || hasText(f.upc),
};

const CONDITION: Requirement = {
  key: 'condition',
  label: 'Item condition',
  satisfied: (f) => hasText(f.condition),
};

const HANDLING: Requirement = {
  key: 'handlingTime',
  label: 'Handling time in days',
  satisfied: (f) => f.handlingTimeDays != null && f.handlingTimeDays >= 0,
};

const CATEGORY: Requirement = {
  key: 'category',
  label: 'A category on this channel',
  satisfied: (f) => hasText(f.categoryRef),
};

const ASPECTS: Requirement = {
  key: 'aspects',
  label: 'The category\u2019s required item specifics',
  satisfied: (f) => f.missingRequiredAspects.length === 0,
};

const EBAY_TITLE: Requirement = {
  key: 'ebayTitle',
  label: 'An eBay title (80 characters)',
  satisfied: (f) => hasText(f.ebayTitle),
};

const DESCRIPTION: Requirement = {
  key: 'description',
  label: 'A product description',
  satisfied: (f) => hasText(f.descriptionHtml),
};

const IMAGE: Requirement = {
  key: 'image',
  label: 'At least one image',
  satisfied: (f) => f.imageCount > 0,
};

const PACKAGE: Requirement = {
  key: 'package',
  label: 'Package weight and dimensions',
  satisfied: (f) => f.packageWeightKg != null && f.packageWeightKg > 0 && f.hasPackageDimensions,
};

const DELIVERY_TEMPLATE: Requirement = {
  key: 'deliveryTemplate',
  label: 'A delivery template',
  satisfied: (f) => hasText(f.deliveryTemplate),
};

/**
 * What each channel needs from us.
 *
 * Amazon and OnBuy attach to a catalogue entry, so they ask for an identifier and commercial terms
 * and nothing else — no title, no description, no images. eBay and Shopify have no catalogue to
 * join, so everything a buyer sees has to come from us.
 */
export const CHANNEL_REQUIREMENTS: Record<string, Requirement[]> = {
  amazon: [IDENTIFIER, CONDITION, HANDLING],
  onbuy: [IDENTIFIER, CONDITION, DELIVERY_TEMPLATE],
  ebay: [EBAY_TITLE, DESCRIPTION, IMAGE, CATEGORY, ASPECTS, CONDITION, PACKAGE],
};

export interface ReadinessVerdict {
  ready: boolean;
  /** What to go and do, in the order the requirements are declared. */
  missing: { key: string; label: string }[];
  satisfiedCount: number;
  totalCount: number;
}

export function evaluateReadiness(channelType: string, facts: ListingFacts): ReadinessVerdict {
  const requirements = CHANNEL_REQUIREMENTS[channelType] ?? [];
  const missing = requirements.filter((r) => !r.satisfied(facts)).map((r) => ({ key: r.key, label: r.label }));
  return {
    ready: missing.length === 0,
    missing,
    satisfiedCount: requirements.length - missing.length,
    totalCount: requirements.length,
  };
}

/**
 * The boost rate a plan may carry.
 *
 * OnBuy defaults new offers to 20%, a fifth of revenue. Refused rather than warned about: a warning
 * on a bulk action is read once, and the commission is paid every month afterwards.
 */
export function checkBoost(boostPct: number, maxBoostPct: number): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(boostPct) || boostPct < 0) return { ok: false, reason: 'Boost must be zero or more' };
  if (boostPct > maxBoostPct) {
    return {
      ok: false,
      reason: maxBoostPct === 0
        ? `Boost is capped at 0% — raise the platform limit before setting ${boostPct}%`
        : `Boost of ${boostPct}% is above the ${maxBoostPct}% limit`,
    };
  }
  return { ok: true };
}
