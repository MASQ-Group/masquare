/**
 * The eBay listing description: one house design, rendered from content.
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

/** From `packages/config` — the same tokens the platform itself uses. */
const C = {
  ink: '#232A31', // n-800
  muted: '#4D5963', // n-600
  line: '#DDE3E9', // n-200
  wash: '#F6F8FA', // n-50
  paper: '#FFFFFF', // n-0
  brand: '#14A79D', // teal-500
  brandDark: '#0B645E', // teal-700
  accent: '#F1592A', // orange-500, used once and only as a rule
} as const;

const FONT = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface DescriptionContent {
  /** The product's name as a buyer should read it. */
  title: string;
  brand?: string | null;
  /** Plain prose. Blank lines separate paragraphs; no markup is honoured. */
  intro?: string | null;
  /** Short selling points, one per line. */
  features?: readonly string[];
  /** The specification table — supplied already validated; this only lays it out. */
  specs?: readonly { label: string; value: string }[];
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

/**
 * The whole description, or an empty string when there is nothing worth showing.
 *
 * An empty string rather than an empty shell: a listing with a heading and three blank sections
 * looks broken, and eBay would rather have the title alone than a hollow frame.
 */
export function renderEbayDescription(content: DescriptionContent): string {
  const title = clean(content.title, 200);
  const brand = clean(content.brand, 80);

  const paragraphs = (content.intro ?? '')
    .split(/\n\s*\n/)
    .map((p) => clean(p, 1200))
    .filter(Boolean)
    .slice(0, 6);

  const features = (content.features ?? [])
    .map((f) => clean(f, 240))
    .filter(Boolean)
    .slice(0, 12);

  const specs = (content.specs ?? [])
    .map((s) => ({ label: clean(s.label, 80), value: clean(s.value, 240) }))
    .filter((s) => s.label && s.value)
    .slice(0, 40);

  if (!title && paragraphs.length === 0 && features.length === 0 && specs.length === 0) return '';

  const sections: string[] = [];

  if (title) {
    sections.push(
      `<div style="border-left:4px solid ${C.brand};padding:0 0 0 14px;margin:0 0 18px">`
      + `<h2 style="margin:0;font:600 22px/1.3 ${FONT};color:${C.ink}">${esc(title)}</h2>`
      + (brand ? `<div style="margin:6px 0 0;font:500 13px/1.4 ${FONT};color:${C.muted};letter-spacing:.02em;text-transform:uppercase">${esc(brand)}</div>` : '')
      + '</div>',
    );
  }

  if (paragraphs.length) {
    sections.push(
      paragraphs
        .map((p) => `<p style="margin:0 0 12px;font:400 15px/1.65 ${FONT};color:${C.ink}">${esc(p)}</p>`)
        .join(''),
    );
  }

  if (features.length) {
    sections.push(
      heading('Key features')
      // Padding rather than list-style: eBay's mobile view renders default bullets inconsistently.
      + `<ul style="margin:0 0 22px;padding:0;list-style:none">${
        features.map((f) => (
          `<li style="position:relative;margin:0 0 9px;padding:0 0 0 22px;font:400 15px/1.6 ${FONT};color:${C.ink}">`
          + `<span style="position:absolute;left:0;top:7px;display:inline-block;width:7px;height:7px;border-radius:50%;background:${C.brand}"></span>`
          + esc(f)
          + '</li>'
        )).join('')
      }</ul>`,
    );
  }

  if (specs.length) {
    sections.push(
      heading('Technical specification')
      + `<table style="width:100%;border-collapse:collapse;margin:0 0 8px;font:400 14px/1.5 ${FONT}" cellpadding="0" cellspacing="0">`
      + '<tbody>'
      + specs.map((s, i) => {
        const bg = i % 2 === 0 ? C.wash : C.paper;
        return `<tr style="background:${bg}">`
          + `<th scope="row" style="width:42%;padding:10px 12px;text-align:left;vertical-align:top;font-weight:600;color:${C.muted};border-bottom:1px solid ${C.line}">${esc(s.label)}</th>`
          + `<td style="padding:10px 12px;vertical-align:top;color:${C.ink};border-bottom:1px solid ${C.line}">${esc(s.value)}</td>`
          + '</tr>';
      }).join('')
      + '</tbody></table>',
    );
  }

  /**
   * `max-width` with `margin:0 auto` rather than a fixed width: eBay renders descriptions inside an
   * iframe of unpredictable width, and a fixed one is what produces sideways scrolling on a phone.
   */
  return `<div style="max-width:820px;margin:0 auto;padding:4px 2px;font:400 15px/1.6 ${FONT};color:${C.ink}">${sections.join('')}</div>`;
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

function heading(text: string): string {
  return `<h3 style="margin:22px 0 12px;padding:0 0 7px;font:600 13px/1.3 ${FONT};color:${C.brandDark};`
    + `text-transform:uppercase;letter-spacing:.08em;border-bottom:2px solid ${C.accent}">${esc(text)}</h3>`;
}
