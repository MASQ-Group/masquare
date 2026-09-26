/**
 * The buyer-facing words, written once and rendered per channel.
 *
 * A title is the same product said to the same buyer whatever the marketplace: brand, model, what
 * the thing is, then the two or three facts people filter on. What differs is the room — eBay stops
 * at 80 characters, OnBuy at 150 — and writing the title separately per channel meant writing the
 * same sentence again with a different ruler beside it. So the PARTS are stored and each channel's
 * title is assembled to its own limit.
 *
 * The same for prose: paragraphs and feature lines are the substance, and each channel decides
 * whether it wants them as plain text, as basic HTML, or laid into a template. eBay already works
 * this way — maSquare renders its description from one house template rather than storing finished
 * copy — so this extends a pattern that is already proven rather than inventing one.
 *
 * Nothing here replaces a channel's own words. A title somebody wrote for eBay is eBay's title; this
 * answers only where a channel has nothing.
 *
 * PURE.
 */

/** What a title is made of, in the order a title says it. */
export interface TitleParts {
  brand?: string | null;
  /** The model or part number a buyer searches for. */
  model?: string | null;
  /** What the thing IS, in a buyer's words: "espresso machine", not "appliance". */
  whatItIs?: string | null;
  /**
   * The facts buyers filter on — colour, capacity, material. In priority order: the room runs out
   * from the end, so the least useful goes first.
   */
  attributes?: readonly string[];
}

export interface ProductCopy {
  title?: TitleParts | null;
  /** Plain prose, one entry per paragraph. No markup: each channel adds its own. */
  paragraphs?: readonly string[];
  /** Ordered selling points, one line each. */
  features?: readonly string[];
}

const clean = (s: string | null | undefined): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * A title assembled to fit, by dropping what matters least rather than by cutting.
 *
 * A truncated title is worse than a shorter one: "Sage Barista Express Espresso Machine 1850W Stainl"
 * reads as a mistake, and eBay counts the characters whether or not the last word survived. So parts
 * are dropped whole, from the end, until what is left fits — and the identity (brand, model, what it
 * is) is never dropped, because a title without it is not a shorter title but a different one.
 */
export function renderTitle(parts: TitleParts | null | undefined, limit: number): string {
  const p = parts ?? {};
  const identity = [clean(p.brand), clean(p.model), clean(p.whatItIs)].filter(Boolean);
  const attributes = (p.attributes ?? []).map(clean).filter(Boolean);
  const join = (bits: readonly string[]) => bits.join(' ').trim();

  for (let keep = attributes.length; keep >= 0; keep--) {
    const line = join([...identity, ...attributes.slice(0, keep)]);
    if (line.length <= limit) return line;
  }
  /**
   * The identity alone is over the limit. Nothing here can make it fit honestly, so it is returned
   * whole and the channel's own check refuses it — a fabricated title that fits would be worse than
   * a clear refusal, and the caller can see exactly what was too long.
   */
  return join(identity);
}

/** Whether a title of these parts can be said inside a channel's limit at all. */
export const titleFits = (parts: TitleParts | null | undefined, limit: number): boolean =>
  renderTitle(parts, limit).length <= limit;

/** Paragraphs as the channel wants them: plain text, or the basic HTML most marketplaces accept. */
export function renderParagraphs(paragraphs: readonly string[] | null | undefined, format: 'plain' | 'html'): string {
  const kept = (paragraphs ?? []).map((s) => clean(s)).filter(Boolean);
  if (!kept.length) return '';
  return format === 'html'
    ? kept.map((s) => `<p>${escapeHtml(s)}</p>`).join('')
    : kept.join('\n\n');
}

/** Feature lines, capped where a channel caps them. */
export function renderFeatures(features: readonly string[] | null | undefined, max?: number): string[] {
  const kept = (features ?? []).map((s) => clean(s)).filter(Boolean);
  return max != null ? kept.slice(0, Math.max(0, max)) : kept;
}

/**
 * Escaped for the small HTML marketplaces accept.
 *
 * The prose is stored plain precisely so each channel can decide its own markup — which means an
 * ampersand or an angle bracket in a product name must not become markup by accident on the way out.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** What we hold, read back from the JSON column without trusting its shape. */
export function readProductCopy(raw: unknown): ProductCopy {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const t = o.title && typeof o.title === 'object' ? (o.title as Record<string, any>) : {};
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => clean(String(x))).filter(Boolean) : []);
  return {
    title: {
      brand: clean(t.brand) || null,
      model: clean(t.model) || null,
      whatItIs: clean(t.whatItIs) || null,
      attributes: list(t.attributes),
    },
    paragraphs: list(o.paragraphs),
    features: list(o.features),
  };
}

/** Whether there is enough here to say anything at all. */
export const hasCopy = (c: ProductCopy): boolean =>
  !!(c.title?.brand || c.title?.model || c.title?.whatItIs || c.paragraphs?.length || c.features?.length);

/** eBay's own cap, which it enforces itself: a longer title is refused, not trimmed. */
export const EBAY_TITLE_MAX = 80;
