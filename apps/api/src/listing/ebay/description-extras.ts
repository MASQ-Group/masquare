/**
 * Everything the eBay description needs beyond the title, prose, features and item specifics.
 *
 * Two owners, stored in two places, because they change at different rates and for different reasons:
 *
 *   STORE — the eBay account's own words: its name, its standard condition wording, its shipping and
 *   returns lines. Written once on the eBay UK channel card, the same on every listing of that
 *   account, kept in the integration's config.
 *
 *   PRODUCT — what research found for this product: the series line, the at-a-glance figures,
 *   In the box, Care, its questions, and which group each item specific belongs to. Written by Claude
 *   through the connector (or a person in section 3), kept on the product's eBay plan.
 *
 * The trust points are neither: they are fixed in the template for every listing.
 *
 * PURE.
 */

export interface LabelValue { label: string; value: string }

// ── Store ──────────────────────────────────────────────────────────────────────────────────────────

export interface EbayDescriptionStore {
  storeName: string | null;
  conditionLabel: string | null;
  conditionNote: string | null;
  shipping: LabelValue[];
}

export const STORE_KEY = 'ebayDescriptionStore';

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return t || null;
};

const labelValues = (v: unknown, max: number, labelMax: number, valueMax: number): LabelValue[] =>
  (Array.isArray(v) ? v : [])
    .map((r) => ({ label: str((r as any)?.label, labelMax) ?? '', value: str((r as any)?.value, valueMax) ?? '' }))
    .filter((r) => r.label && r.value)
    .slice(0, max);

export function descriptionStore(config: unknown): EbayDescriptionStore {
  const bag = (config as Record<string, unknown> | null)?.[STORE_KEY];
  const d = bag && typeof bag === 'object' ? (bag as Record<string, unknown>) : {};
  return {
    storeName: str(d.storeName, 60),
    conditionLabel: str(d.conditionLabel, 60),
    conditionNote: str(d.conditionNote, 400),
    shipping: labelValues(d.shipping, 6, 40, 120),
  };
}

/** The config to store after a change; everything else in the config is left alone. */
export function withDescriptionStore(config: unknown, next: Partial<EbayDescriptionStore>): Record<string, unknown> {
  const base = config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : {};
  const merged = { ...descriptionStore(config), ...next };
  base[STORE_KEY] = descriptionStore({ [STORE_KEY]: merged });
  return base;
}

// ── Product ────────────────────────────────────────────────────────────────────────────────────────

/** A figure in the at-a-glance strip, tied to the item specific it was taken from. */
export interface GlancePick { aspect: string; label: string; value: string }

export interface DescriptionExtras {
  series: string | null;
  inTheBox: string | null;
  care: string | null;
  faq: { q: string; a: string }[];
  glance: GlancePick[];
  /** Item specific name → group heading. Anything not named here goes under General. */
  groups: Record<string, string>;
}

export const EMPTY_EXTRAS: DescriptionExtras = { series: null, inTheBox: null, care: null, faq: [], glance: [], groups: {} };

export const EXTRAS_LIMITS = { series: 120, box: 400, care: 400, faq: 6, question: 200, answer: 600, glance: 4, glanceLabel: 40, glanceValue: 24, group: 40, groups: 8 } as const;

/** Whatever the column holds, as the typed shape. Anything unreadable reads as absent. */
export function normaliseExtras(raw: unknown): DescriptionExtras {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const faq = (Array.isArray(d.faq) ? d.faq : [])
    .map((f) => ({ q: str((f as any)?.q, EXTRAS_LIMITS.question) ?? '', a: str((f as any)?.a, EXTRAS_LIMITS.answer) ?? '' }))
    .filter((f) => f.q && f.a)
    .slice(0, EXTRAS_LIMITS.faq);
  const glance = (Array.isArray(d.glance) ? d.glance : [])
    .map((g) => ({
      aspect: str((g as any)?.aspect, 80) ?? '',
      label: str((g as any)?.label, EXTRAS_LIMITS.glanceLabel) ?? '',
      value: str((g as any)?.value, EXTRAS_LIMITS.glanceValue) ?? '',
    }))
    .filter((g) => g.aspect && g.label && g.value)
    .slice(0, EXTRAS_LIMITS.glance);
  const groups: Record<string, string> = {};
  if (d.groups && typeof d.groups === 'object') {
    for (const [aspect, group] of Object.entries(d.groups as Record<string, unknown>)) {
      const a = str(aspect, 80);
      const g = str(group, EXTRAS_LIMITS.group);
      if (a && g) groups[a] = g;
    }
  }
  return {
    series: str(d.series, EXTRAS_LIMITS.series),
    inTheBox: str(d.inTheBox, EXTRAS_LIMITS.box),
    care: str(d.care, EXTRAS_LIMITS.care),
    faq,
    glance,
    groups,
  };
}

const canon = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The at-a-glance figures that may actually be shown.
 *
 * A figure is kept only while the item specific it names still holds a VERIFIED value, and only when
 * the figure is that value or a piece of it ("33.2 mm" out of "33.2 mm wide, 8.2 mm thick"). So the
 * strip can shorten a checked fact but never state one — a value held back for a person, or changed
 * since, drops out of the strip on its own.
 */
export function resolveGlance(picks: readonly GlancePick[], verified: Readonly<Record<string, string>>): LabelValue[] {
  const byName = new Map(Object.entries(verified).map(([k, v]) => [canon(k), v]));
  return picks
    .filter((p) => {
      const v = byName.get(canon(p.aspect));
      return !!v && canon(v).includes(canon(p.value));
    })
    .map((p) => ({ label: p.label, value: p.value }))
    .slice(0, EXTRAS_LIMITS.glance);
}

/**
 * The specification table, grouped.
 *
 * Brand and MPN lead General. Each verified item specific goes under the group research named for
 * it, or General when none was named; groups keep the order in which they first appear, with General
 * always first. Only verified values arrive here, so grouping can reorder the table but never add to it.
 */
export function groupSpecs(
  facts: { brand?: string | null; mpn?: string | null },
  verified: Readonly<Record<string, string>>,
  groups: Readonly<Record<string, string>>,
): { name: string; rows: LabelValue[] }[] {
  const byCanon = new Map(Object.entries(groups).map(([k, v]) => [canon(k), v]));
  const order: string[] = ['General'];
  const rows = new Map<string, LabelValue[]>([['General', []]]);
  const add = (group: string, row: LabelValue) => {
    const name = group.trim() || 'General';
    const key = order.find((o) => canon(o) === canon(name)) ?? name;
    if (!rows.has(key)) { rows.set(key, []); order.push(key); }
    rows.get(key)!.push(row);
  };
  if (facts.brand) add('General', { label: 'Brand', value: facts.brand });
  if (facts.mpn) add('General', { label: 'MPN', value: facts.mpn });
  for (const [label, value] of Object.entries(verified)) {
    if (!value?.trim()) continue;
    if (['brand', 'mpn'].includes(canon(label))) continue;
    add(byCanon.get(canon(label)) ?? 'General', { label, value });
  }
  return order.map((name) => ({ name, rows: rows.get(name)! })).filter((g) => g.rows.length).slice(0, EXTRAS_LIMITS.groups);
}
