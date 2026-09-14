/**
 * Pulling a specification table out of a manufacturer's product page.
 *
 * Deliberately narrow, and narrow in a specific way: it reads STRUCTURE, never prose. A spec table
 * or a definition list is a manufacturer stating "Capacity: 2.5 L" in a form that cannot mean
 * anything else. A sentence in a marketing paragraph saying the jug holds around two and a half
 * litres is a claim that needs a reader, and a machine that tries to read it will eventually
 * misread one — which, under a rule that treats the manufacturer as authoritative, would publish a
 * wrong specification with the highest possible confidence behind it.
 *
 * So: two-cell table rows, and dt/dd pairs. Nothing else. A page whose specifications are laid out
 * some other way yields nothing, and yielding nothing is a visible gap somebody can fill rather than
 * a plausible invention nobody questions.
 *
 * Written against strings rather than a DOM on purpose. The alternative was a parser dependency for
 * a job with two shapes, and a lenient HTML parser would happily find "structure" in places this
 * refuses to look.
 *
 * PURE.
 */

/** Entities common enough in spec cells to matter. Anything else is left as written. */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  deg: '°', times: '×', middot: '·', ndash: '–', mdash: '—', hellip: '…',
  eacute: 'é', egrave: 'è', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** A code point outside the usable range is left as the original text rather than becoming junk. */
function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** The readable text of one cell: no tags, no entities, no runs of whitespace. */
function cellText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

/**
 * Limits that separate a specification from something else on the page.
 *
 * A label longer than this is a sentence; a value longer than this is a paragraph. Both appear in
 * two-cell rows on real pages — a "Description" row, a returns policy in a layout table — and both
 * would be stored as item specifics if length were not the thing that tells them apart.
 */
const MAX_LABEL = 60;
const MAX_VALUE = 200;

export interface SpecPair { field: string; value: string }

/**
 * Every label/value pair the page states structurally.
 *
 * First writing of a label wins. Manufacturer pages repeat their spec table — once in a tab, once
 * in a collapsed panel for mobile — and the second copy says nothing the first did not.
 */
export function extractSpecPairs(html: string): SpecPair[] {
  // Script and style bodies are code, and code in a table cell is not a specification.
  const clean = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const seen = new Set<string>();
  const out: SpecPair[] = [];

  const add = (rawLabel: string, rawValue: string) => {
    const field = cellText(rawLabel).replace(/[:\s]+$/, '');
    const value = cellText(rawValue);

    if (!field || !value) return;                       // Half a pair is not a fact.
    if (field.length > MAX_LABEL || value.length > MAX_VALUE) return;
    if (!/[a-z]/i.test(field)) return;                  // A label with no letters is a layout artefact.
    if (field.toLowerCase() === value.toLowerCase()) return; // A cell repeated across two columns.

    const key = field.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ field, value });
  };

  /**
   * Two-cell rows only. A three-column row is a comparison table — one label against several
   * products — and taking its first value would attach a competitor's specification to this one.
   */
  for (const row of clean.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = row.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) ?? [];
    if (cells.length !== 2) continue;
    add(cells[0], cells[1]);
  }

  /** A definition list says the same thing in the other common shape. */
  for (const pair of clean.match(/<dt\b[^>]*>[\s\S]*?<\/dt>\s*<dd\b[^>]*>[\s\S]*?<\/dd>/gi) ?? []) {
    const dt = pair.match(/<dt\b[^>]*>([\s\S]*?)<\/dt>/i)?.[1] ?? '';
    const dd = pair.match(/<dd\b[^>]*>([\s\S]*?)<\/dd>/i)?.[1] ?? '';
    add(dt, dd);
  }

  return out;
}

/**
 * The page's own idea of what product it is, for the identity check.
 *
 * Only what the page states about itself — the title tag and any Open Graph title. Never enough on
 * its own to confirm identity, which is the point: `verifyIdentity` wants a brand or a part number,
 * and a title alone is exactly the evidence it refuses.
 */
export function extractPageIdentity(html: string): { brand: string | null; mpns: string[]; title: string | null } {
  const title = cellText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') || null;

  const meta = (prop: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i');
    const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
    return cellText(html.match(re)?.[1] ?? html.match(alt)?.[1] ?? '') || null;
  };

  const pairs = extractSpecPairs(html);
  const byLabel = (...names: string[]) => pairs
    .filter((p) => names.includes(p.field.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .map((p) => p.value);

  return {
    brand: meta('og:brand') ?? meta('product:brand') ?? byLabel('brand', 'manufacturer')[0] ?? null,
    mpns: byLabel('mpn', 'partnumber', 'modelnumber', 'model', 'articlenumber', 'itemnumber'),
    title: meta('og:title') ?? title,
  };
}
