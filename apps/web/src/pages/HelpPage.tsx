import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { marked } from 'marked';
import { BookOpen, FileText, Search, X } from 'lucide-react';
import { PAGES, headingId, pageBySlug, searchHelp, sections, type HelpPage as Page } from '../help/content';

/**
 * The in-platform handbook.
 *
 * Content is markdown in `src/help`, compiled into the bundle, so the help works whenever the app
 * does — including while the API is refusing calls, which is exactly when somebody is most likely
 * to come looking for it.
 */
export function HelpPage() {
  const params = useParams();
  const slug = (params['*'] ?? '').replace(/\/$/, '');
  const page = pageBySlug(slug) ?? pageBySlug('');
  const [query, setQuery] = useState('');
  const groups = useMemo(() => sections(), []);
  const hits = useMemo(() => searchHelp(query), [query]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [slug]);

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center gap-2.5">
        <BookOpen size={18} className="text-teal-600" />
        <h1 className="text-[19px] font-semibold text-n-900">Help</h1>
        <span className="text-[12.5px] text-n-500">How the platform fits together</span>
      </div>

      <div className="flex gap-5 max-[900px]:flex-col">
        {/* ---------------------------------------------------------------- sidebar */}
        <aside className="w-[240px] shrink-0 max-[900px]:w-full">
          <div className="relative mb-3">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
            <input
              className="input pl-8 pr-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the help…"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-n-400 hover:bg-n-100 hover:text-n-700"
                title="Clear"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {query.trim().length >= 2 ? (
            <SearchResults hits={hits} onPick={() => setQuery('')} />
          ) : (
            <nav className="flex flex-col gap-4">
              {groups.map((g) => (
                <div key={g.section}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">{g.section}</div>
                  <div className="flex flex-col gap-0.5">
                    {g.pages.map((p) => (
                      <Link
                        key={p.slug}
                        to={`/help/${p.slug}`}
                        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition ${
                          p.slug === (page?.slug ?? '')
                            ? 'bg-teal-50 font-semibold text-teal-800'
                            : 'text-n-600 hover:bg-n-50 hover:text-n-900'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{p.title}</span>
                        {p.status === 'outline' && (
                          <span className="shrink-0 rounded border border-n-200 bg-n-50 px-1 text-[9.5px] font-semibold uppercase text-n-500">
                            outline
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          )}
        </aside>

        {/* ---------------------------------------------------------------- content */}
        <div className="min-w-0 flex-1">
          {page ? <Article page={page} /> : <p className="text-[13px] text-n-500">That help page does not exist.</p>}
        </div>
      </div>
    </div>
  );
}

function SearchResults({ hits, onPick }: { hits: ReturnType<typeof searchHelp>; onPick: () => void }) {
  if (!hits.length) {
    return <p className="px-1 text-[12.5px] text-n-500">Nothing matches. Try a shorter word — search matches prefixes.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-n-500">
        {hits.length} result{hits.length === 1 ? '' : 's'}
      </div>
      {hits.map((h) => (
        <Link
          key={h.page.slug}
          to={`/help/${h.page.slug}`}
          onClick={onPick}
          className="rounded-md border border-n-200 px-2.5 py-2 hover:border-teal-300 hover:bg-teal-50"
        >
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-n-800">
            <FileText size={12} className="shrink-0 text-n-400" />
            {h.page.title}
          </div>
          <div className="mt-0.5 line-clamp-3 text-[11.5px] leading-4 text-n-500">{h.excerpt}</div>
        </Link>
      ))}
    </div>
  );
}

function Article({ page }: { page: Page }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');

  useEffect(() => {
    // Anchors on headings, so the contents list and deep links work.
    const renderer = new marked.Renderer();
    renderer.heading = ({ tokens, depth }: any) => {
      const text = tokens.map((t: any) => t.raw ?? t.text ?? '').join('');
      const id = headingId(text);
      return `<h${depth} id="${id}">${marked.parseInline(text)}</h${depth}>`;
    };
    setHtml(marked.parse(page.body, { renderer, async: false }) as string);
  }, [page.slug, page.body]);

  // Diagrams are rendered after the markdown lands, and mermaid is only fetched when a page
  // actually contains one — it is by far the heaviest thing here and most pages have none.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const blocks = [...root.querySelectorAll('pre > code.language-mermaid')];
    if (!blocks.length) return;

    let cancelled = false;
    (async () => {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
          primaryColor: '#E6F4F3',
          primaryBorderColor: '#14A79D',
          primaryTextColor: '#16211F',
          lineColor: '#8A9A96',
          fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
          fontSize: '13px',
        },
      });
      for (const [i, block] of blocks.entries()) {
        if (cancelled) return;
        const code = block.textContent ?? '';
        const host = block.parentElement!;
        try {
          const { svg } = await mermaid.render(`help-diagram-${page.slug.replace(/\W/g, '-')}-${i}`, code);
          if (cancelled) return;
          const figure = document.createElement('figure');
          figure.className = 'help-diagram';
          figure.innerHTML = svg;
          host.replaceWith(figure);
        } catch {
          // A diagram that will not parse must not take the page down with it — the prose around
          // it is the part that matters, and a visible code block is a legible fallback.
          host.classList.add('help-diagram-failed');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [html, page.slug]);

  const contents = page.headings.filter((h) => h.level === 2);

  return (
    <article className="card p-6 max-[767px]:p-4">
      {page.status === 'outline' && (
        <p className="mb-4 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          This page is an outline. What is written is accurate; the sections listed at the end have not been written yet.
        </p>
      )}

      {contents.length > 2 && (
        <nav className="mb-5 rounded-lg border border-n-200 bg-n-25 px-3.5 py-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">On this page</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {contents.map((h) => (
              <a key={h.id} href={`#${h.id}`} className="text-[12.5px] text-teal-700 hover:underline">{h.text}</a>
            ))}
          </div>
        </nav>
      )}

      <div ref={ref} className="help-prose" dangerouslySetInnerHTML={{ __html: html }} />

      {(page.reviewed || page.covers.length > 0) && (
        <footer className="mt-8 border-t border-n-100 pt-3 text-[11.5px] text-n-400">
          {page.reviewed && <>Checked against the code on {page.reviewed}. </>}
          {page.covers.length > 0 && (
            <>Describes <span className="mono">{page.covers.length}</span> source path{page.covers.length === 1 ? '' : 's'};
            a test fails when they change and this page has not been reviewed.</>
          )}
        </footer>
      )}
    </article>
  );
}

/** Every page, for the staleness test and for anything that wants the whole corpus. */
export const HELP_PAGES = PAGES;
