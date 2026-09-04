import MiniSearch from 'minisearch';

/**
 * The help corpus.
 *
 * Markdown files in this folder, pulled in at build time by Vite's glob import. Content lives in
 * the repo rather than a database on purpose: a documentation change can then travel in the same
 * commit as the code change that made it necessary, which is the only mechanism that reliably
 * keeps the two in step. It also means a wrong page is caught in review, like any other diff.
 */
const FILES = import.meta.glob('./**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface HelpPage {
  /** Route slug: `processes/how-a-sku-gets-its-cost`, or '' for the index. */
  slug: string;
  title: string;
  section: string;
  order: number;
  summary: string;
  /** Present when the page is knowingly incomplete, so a reader can tell it apart from finished. */
  status?: 'outline';
  /** Source paths this page describes. The staleness test reads these. */
  covers: string[];
  reviewed?: string;
  /** Markdown with the frontmatter removed. */
  body: string;
  /** Headings, for search result context and the on-page contents. */
  headings: { level: number; text: string; id: string }[];
}

export const headingId = (text: string) =>
  text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

/**
 * Minimal frontmatter reader.
 *
 * Deliberately not a YAML library: the corpus is ours, the shape is five keys, and a parser we
 * control is one fewer dependency whose behaviour we have to know. Anything it cannot read is
 * ignored rather than thrown, because a malformed header should cost you a field, not the page.
 */
function parseFrontmatter(raw: string): { data: Record<string, any>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, any> = {};
  let listKey: string | null = null;

  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(item[1].trim());
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value.trim() === '') {
      listKey = key;
      data[key] = [];
    } else {
      listKey = null;
      data[key] = value.trim().replace(/^["']|["']$/g, '');
    }
  }
  return { data, body: raw.slice(match[0].length) };
}

function headingsOf(body: string) {
  const out: { level: number; text: string; id: string }[] = [];
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    // Headings inside a fenced block are code, not structure — a `# comment` in a shell snippet
    // would otherwise turn up in the contents list and in search results.
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), id: headingId(m[2]) });
  }
  return out;
}

export const PAGES: HelpPage[] = Object.entries(FILES)
  .map(([path, raw]) => {
    const { data, body } = parseFrontmatter(raw);
    const slug = path.replace(/^\.\//, '').replace(/\.md$/, '').replace(/\/index$/, '').replace(/^index$/, '');
    return {
      slug,
      title: data.title ?? slug,
      section: data.section ?? 'Other',
      order: Number(data.order ?? 999),
      summary: data.summary ?? '',
      status: data.status,
      covers: Array.isArray(data.covers) ? data.covers : [],
      reviewed: data.reviewed,
      body,
      headings: headingsOf(body),
    };
  })
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

export const pageBySlug = (slug: string) => PAGES.find((p) => p.slug === slug);

/** Sections in the order their first page declares, so the sidebar reads like the handbook. */
export function sections(): { section: string; pages: HelpPage[] }[] {
  const out: { section: string; pages: HelpPage[] }[] = [];
  for (const page of PAGES) {
    const found = out.find((s) => s.section === page.section);
    if (found) found.pages.push(page);
    else out.push({ section: page.section, pages: [page] });
  }
  return out;
}

/**
 * The search index.
 *
 * Built in the browser from a corpus measured in tens of pages — small enough that indexing costs
 * a few milliseconds and every keystroke answers instantly with no request. A server search would
 * be slower and could not work while the API is refusing calls, which is exactly when somebody is
 * most likely to be reading the help.
 *
 * Titles and headings are weighted well above body text: people search for the name of the thing
 * they are looking at, not for a sentence inside it.
 */
export const searchIndex = new MiniSearch<{ id: string; title: string; headings: string; summary: string; body: string }>({
  fields: ['title', 'headings', 'summary', 'body'],
  storeFields: ['title'],
  searchOptions: {
    boost: { title: 5, headings: 3, summary: 2 },
    prefix: true,
    fuzzy: 0.2,
  },
});

searchIndex.addAll(
  PAGES.map((p) => ({
    id: p.slug,
    title: p.title,
    headings: p.headings.map((h) => h.text).join(' \n '),
    summary: p.summary,
    // Fenced code is stripped: a search for "cost" should not rank a page because the word appears
    // in a diagram's node ids.
    body: p.body.replace(/```[\s\S]*?```/g, ' '),
  })),
);

export interface HelpHit {
  page: HelpPage;
  /** A sentence or two around the match, for the result list. */
  excerpt: string;
}

/** Search, with a short excerpt drawn from around the first match in the body. */
export function searchHelp(query: string, limit = 12): HelpHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  return searchIndex
    .search(q)
    .slice(0, limit)
    .map((r) => {
      const page = pageBySlug(String(r.id))!;
      return { page, excerpt: excerptFor(page, q) };
    })
    .filter((h) => !!h.page);
}

function excerptFor(page: HelpPage, query: string): string {
  const plain = page.body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const term = query.split(/\s+/)[0].toLowerCase();
  const at = plain.toLowerCase().indexOf(term);
  if (at < 0) return page.summary || plain.slice(0, 160);
  const start = Math.max(0, at - 70);
  return (start > 0 ? '…' : '') + plain.slice(start, start + 200).trim() + '…';
}
