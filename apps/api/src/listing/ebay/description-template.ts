/**
 * The eBay listing description: one house design, rendered from content.
 *
 * The design is the TogaluUK "Option 1b (Cards)" handoff — header band, at-a-glance figures, feature
 * and specification cards, In the box / Condition / Care, shipping and trust, questions.
 *
 * The content is written by a researcher (a person, or Claude through the connector) as plain text —
 * an introduction and some feature lines. The DESIGN is not theirs to choose. Everything below is
 * fixed here, so every listing in the catalogue shares one skeleton, one type scale and one palette,
 * and restyling all of them later is an edit to this file rather than a regeneration of thousands of
 * descriptions.
 *
 * That split is the reason this module exists. A writer handed raw HTML produces a slightly
 * different page each time — a heading here, a table there — and after two thousand products there
 * is no design left to change.
 *
 * Three constraints come from eBay rather than from taste:
 *
 *   - INLINE STYLES ONLY. eBay strips `<style>` blocks and external stylesheets from descriptions,
 *     so every rule is written on the element it applies to. Verbose, and not negotiable.
 *   - NO ACTIVE CONTENT. No script, no form, no iframe, no external links or contact details; eBay
 *     forbids them and a listing carrying them can be removed.
 *   - EVERYTHING ESCAPED. The text arrives from a web search, so it is data, not markup. A stray
 *     `<` in a specification must render as a `<`, never open a tag.
 *
 * PURE.
 */

/**
 * Design tokens from the eBay description handoff (Option 1b, Cards). High fidelity: these are the
 * design's own values, not the platform's — the listing is TogaluUK's page, not maSquare's.
 */
const C = {
  teal: '#0e7c7b',
  orange: '#e4572e', // header square and trust bullets only
  ink: '#1f2933',
  body: '#3a4550',
  muted: '#6b7680',
  border: '#e6eaec',
  rowLine: '#edf0f2',
  paper: '#ffffff',
  wash: '#f5f8f8', // card headers, trust card
  strip: '#fafbfb', // at-a-glance strip, spec group rows
} as const;

/** Public Sans will not load inside eBay; the system fallback is the design's expectation. */
const FONT = "'Public Sans',system-ui,-apple-system,'Segoe UI',sans-serif";

/**
 * The trust points, the same on every listing. Fixed by the business rather than written per
 * product or per account.
 */
export const TRUST_POINTS: readonly string[] = [
  '100% genuine, sourced from authorised distributors',
  'Top-rated seller, thousands of 5-star reviews',
  'Messages answered within 24 hours',
];

export interface LabelValue { label: string; value: string }

export interface DescriptionContent {
  /** The eBay listing title, as a buyer reads it. */
  title: string;
  brand?: string | null;
  mpn?: string | null;
  /** The product line, e.g. "Casio Vintage series". Shown before the reference under the title. */
  series?: string | null;
  /** From the eBay channel card: the store name in the header and in "Why …". */
  storeName?: string | null;
  /** From the eBay channel card: the short condition in the header, e.g. "New · boxed". */
  conditionLabel?: string | null;
  /** Three or four figures a buyer takes in at a glance. Already checked against verified specifics. */
  glance?: readonly LabelValue[];
  /** Plain prose. Blank lines separate paragraphs; no markup is honoured. */
  intro?: string | null;
  features?: readonly string[];
  /** The specification, grouped. Supplied already validated; this only lays it out. */
  specGroups?: readonly { name: string; rows: readonly LabelValue[] }[];
  /** A flat specification with no groups — shown as one General group. */
  specs?: readonly LabelValue[];
  inTheBox?: string | null;
  /** From the eBay channel card: the standard condition wording. */
  conditionNote?: string | null;
  care?: string | null;
  /** From the eBay channel card. */
  shipping?: readonly LabelValue[];
  faq?: readonly { q: string; a: string }[];
}

/** HTML-escape. Quotes included, because values are also written into attributes. */
function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const clean = (s: string | null | undefined, max: number): string =>
  (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const pairs = (list: readonly LabelValue[] | undefined, max: number, labelMax = 80, valueMax = 240) =>
  (list ?? [])
    .map((r) => ({ label: clean(r.label, labelMax), value: clean(r.value, valueMax) }))
    .filter((r) => r.label && r.value)
    .slice(0, max);

/** The small uppercase card title, with or without the orange square. */
function cardTitle(text: string, withSquare: boolean): string {
  return `<div style="padding:12px 20px;background:${C.wash};border-bottom:1px solid ${C.border};font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.teal};display:flex;align-items:center;gap:10px">`
    + (withSquare ? `<span style="width:8px;height:8px;background:${C.orange};border-radius:2px;flex:none"></span>` : '')
    + `${esc(text)}</div>`;
}

const sectionLabel = (text: string, margin = 12) =>
  `<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.teal};margin-bottom:${margin}px">${esc(text)}</div>`;

/**
 * The whole description, or an empty string when there is nothing worth showing.
 *
 * Layout follows the handoff top to bottom: header band, at-a-glance strip, description, key
 * features card, technical specification card, In the box / Condition / Care, Shipping & returns
 * beside Why-the-store, then Questions. Every section with nothing in it is left out rather than
 * printed as an empty frame.
 *
 * RESPONSIVE WITHOUT MEDIA QUERIES. eBay strips `<style>`, so the handoff's fixed-count grids are
 * built from `flex-wrap` with a minimum width per item instead: four at-a-glance figures sit in a row
 * at 720px and fold to two on a phone, two feature columns fold to one, a spec label drops above its
 * value, and card pairs stack — all decided by the space available, not by a breakpoint.
 */
export function renderEbayDescription(content: DescriptionContent): string {
  const title = clean(content.title, 200);
  const brand = clean(content.brand, 80);
  const mpn = clean(content.mpn, 80);
  const series = clean(content.series, 120);
  const storeName = clean(content.storeName, 60);
  const conditionLabel = clean(content.conditionLabel, 60);

  const glance = pairs(content.glance, 4, 40, 24);
  const paragraphs = (content.intro ?? '')
    .split(/\n\s*\n/)
    .map((p) => clean(p, 1200))
    .filter(Boolean)
    .slice(0, 6);
  const features = (content.features ?? []).map((f) => clean(f, 240)).filter(Boolean).slice(0, 12);

  // Groups, capped as a whole: a runaway specification is refused past sixty rows, not per group.
  let budget = 60;
  const groups = (content.specGroups?.length
    ? content.specGroups
    : content.specs?.length ? [{ name: 'General', rows: content.specs }] : [])
    .map((g) => {
      const rows = pairs(g.rows, Math.max(0, budget));
      budget -= rows.length;
      return { name: clean(g.name, 40) || 'General', rows };
    })
    .filter((g) => g.rows.length)
    .slice(0, 8);

  const inTheBox = clean(content.inTheBox, 400);
  const conditionNote = clean(content.conditionNote, 400);
  const care = clean(content.care, 400);
  const shipping = pairs(content.shipping, 6, 40, 120);
  const faq = (content.faq ?? [])
    .map((f) => ({ q: clean(f.q, 200), a: clean(f.a, 600) }))
    .filter((f) => f.q && f.a)
    .slice(0, 6);

  if (!title && paragraphs.length === 0 && features.length === 0 && groups.length === 0) return '';

  const out: string[] = [];

  // ── 1. Header band ────────────────────────────────────────────────────────────────────────────
  const subtitle = [series, mpn ? `Ref. ${mpn}` : ''].filter(Boolean).join(' · ') || brand;
  out.push(
    `<div style="background:${C.teal};color:#fff;padding:32px 5.5% 28px">`
    + (storeName || conditionLabel
      ? `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:4px 12px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.85">`
        + `<span>${esc(storeName)}</span><span>${esc(conditionLabel)}</span></div>`
      : '')
    + (title ? `<h1 style="margin:14px 0 0;font-size:26px;line-height:1.25;font-weight:700;text-wrap:pretty">${esc(title)}</h1>` : '')
    + (subtitle ? `<div style="margin-top:6px;font-size:14px;opacity:.85">${esc(subtitle)}</div>` : '')
    + '</div>',
  );

  // ── 2. At-a-glance strip ──────────────────────────────────────────────────────────────────────
  // The inner row is pulled 1px past the right and bottom edges so every cell can carry a right and
  // bottom rule and the outermost ones fall outside, however the cells wrap.
  if (glance.length) {
    out.push(
      `<div style="background:${C.strip};border-bottom:1px solid ${C.border};overflow:hidden">`
      + `<div style="display:flex;flex-wrap:wrap;margin:0 -1px -1px 0">`
      + glance.map((g) => (
        `<div style="flex:1 1 150px;padding:14px 12px;text-align:center;border-right:1px solid ${C.border};border-bottom:1px solid ${C.border}">`
        + `<div style="font-size:18px;font-weight:700;color:${C.teal}">${esc(g.value)}</div>`
        + `<div style="font-size:12px;color:${C.muted}">${esc(g.label)}</div></div>`
      )).join('')
      + '</div></div>',
    );
  }

  const body: string[] = [];

  // ── 4. Description ────────────────────────────────────────────────────────────────────────────
  if (paragraphs.length) {
    body.push(
      `<div style="display:flex;flex-direction:column;gap:12px;color:${C.body}">`
      + paragraphs.map((p) => `<p style="margin:0;text-wrap:pretty">${esc(p)}</p>`).join('')
      + '</div>',
    );
  }

  // ── 5. Key features ───────────────────────────────────────────────────────────────────────────
  if (features.length) {
    body.push(
      `<div style="margin-top:${body.length ? 32 : 0}px;border:1px solid ${C.border};border-radius:10px;overflow:hidden">`
      + cardTitle('Key features', true)
      + `<ul style="margin:0;padding:18px 20px;list-style:none;display:flex;flex-wrap:wrap;gap:10px 24px;color:${C.body};font-size:14px">`
      + features.map((f) => (
        `<li style="flex:1 1 240px;display:flex;gap:10px"><span style="flex:none;color:${C.teal};font-weight:700">✓</span><span>${esc(f)}</span></li>`
      )).join('')
      + '</ul></div>',
    );
  }

  // ── 6. Technical specification ────────────────────────────────────────────────────────────────
  if (groups.length) {
    const lastGroup = groups.length - 1;
    body.push(
      `<div style="margin-top:${body.length ? 20 : 0}px;border:1px solid ${C.border};border-radius:10px;overflow:hidden">`
      + cardTitle('Technical specification', true)
      + '<div style="font-size:14px">'
      + groups.map((g, gi) => (
        `<div style="padding:8px 20px;background:${C.strip};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};border-bottom:1px solid ${C.border}">${esc(g.name)}</div>`
        + '<div style="padding:0 20px">'
        + g.rows.map((r, ri) => {
          const rule = gi === lastGroup && ri === g.rows.length - 1 ? '' : `border-bottom:1px solid ${C.rowLine};`;
          return `<div style="display:flex;flex-wrap:wrap;column-gap:12px;padding:9px 0;${rule}">`
            + `<div style="flex:0 1 180px;min-width:120px;color:${C.muted}">${esc(r.label)}</div>`
            + `<div style="flex:1 1 200px;color:${C.ink}">${esc(r.value)}</div></div>`;
        }).join('')
        + '</div>'
      )).join('')
      + '</div></div>',
    );
  }

  // ── 7. In the box / Condition / Care ──────────────────────────────────────────────────────────
  const trio = [
    { title: 'In the box', text: inTheBox },
    { title: 'Condition', text: conditionNote },
    { title: 'Care', text: care },
  ].filter((t) => t.text);
  if (trio.length) {
    body.push(
      `<div style="margin-top:${body.length ? 20 : 0}px;display:flex;flex-wrap:wrap;gap:16px;font-size:14px;color:${C.body}">`
      + trio.map((t) => (
        `<div style="flex:1 1 180px;border:1px solid ${C.border};border-radius:10px;padding:16px 18px">`
        + `<div style="font-weight:700;color:${C.ink};margin-bottom:6px">${esc(t.title)}</div>${esc(t.text)}</div>`
      )).join('')
      + '</div>',
    );
  }

  // ── 8. Shipping & returns / Why the store ─────────────────────────────────────────────────────
  const shippingCard = shipping.length
    ? `<div style="flex:1 1 260px;border:1px solid ${C.border};border-radius:10px;padding:18px 20px">`
      + sectionLabel('Shipping & returns')
      + '<div style="display:flex;flex-direction:column;gap:8px">'
      + shipping.map((s) => (
        `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:${C.muted}">${esc(s.label)}</span><span style="text-align:right">${esc(s.value)}</span></div>`
      )).join('')
      + '</div></div>'
    : '';
  const trustCard = `<div style="flex:1 1 260px;border:1px solid ${C.border};border-radius:10px;padding:18px 20px;background:${C.wash}">`
    + sectionLabel(storeName ? `Why ${storeName}` : 'Why buy from us')
    + '<div style="display:flex;flex-direction:column;gap:8px">'
    + TRUST_POINTS.map((t) => `<div style="display:flex;gap:10px"><span style="color:${C.orange};font-weight:700">●</span><span>${esc(t)}</span></div>`).join('')
    + '</div></div>';
  body.push(
    `<div style="margin-top:${body.length ? 20 : 0}px;display:flex;flex-wrap:wrap;gap:16px;font-size:14px;color:${C.body}">${shippingCard}${trustCard}</div>`,
  );

  // ── 9. Questions ──────────────────────────────────────────────────────────────────────────────
  if (faq.length) {
    body.push(
      '<div style="margin-top:32px">'
      + sectionLabel('Questions')
      + `<div style="display:flex;flex-direction:column;font-size:14px;color:${C.body}">`
      + faq.map((f, i) => (
        `<div style="padding:12px 0;border-top:1px solid ${C.border};${i === faq.length - 1 ? `border-bottom:1px solid ${C.border};` : ''}">`
        + `<strong style="color:${C.ink}">${esc(f.q)}</strong> ${esc(f.a)}</div>`
      )).join('')
      + '</div></div>',
    );
  }

  // 5.5% of the width is the handoff's 40px inset at 720px and its 20px mobile inset at 360px — both
  // from one value, since eBay allows no media queries.
  out.push(`<div style="padding:32px 5.5% 40px">${body.join('')}</div>`);

  /**
   * `max-width` with `margin:0 auto` rather than a fixed width: eBay renders descriptions inside an
   * iframe of unpredictable width, and a fixed one is what produces sideways scrolling on a phone.
   */
  return `<div style="max-width:720px;margin:0 auto;font-family:${FONT};background:${C.paper}">`
    + `<div style="color:${C.ink};font-size:15px;line-height:1.6">${out.join('')}</div></div>`;
}

/**
 * Plain prose, stored as the simple HTML the Description editor expects.
 *
 * Researched copy arrives as plain text with blank lines between paragraphs. Stored raw in
 * `descriptionHtml`, the product card's rich editor would run it into a single paragraph, because
 * newlines mean nothing in HTML. Each paragraph becomes a `<p>`, escaped — the words are data from
 * a web search, never markup — and `htmlToPlainText` turns it back into paragraphs for eBay.
 */
export function proseToHtml(raw: string | null | undefined): string {
  return (raw ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
}

/**
 * The readable words out of stored prose that may contain markup.
 *
 * The Content tab's description is written as prose but has historically been allowed to carry a
 * little HTML. The template escapes everything it is given, so markup passed straight through would
 * render as visible `<p>` tags on a live listing. Stripped here instead, once, where it is tested.
 */
export function htmlToPlainText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    // Block ends become paragraph breaks so the template's own paragraph splitting still works.
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
