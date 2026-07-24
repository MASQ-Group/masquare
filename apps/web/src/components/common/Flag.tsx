/** Small rectangle country flag by ISO 3166-1 alpha-2 code, via the offline flag-icons set
 *  (renders on Windows, unlike emoji flags). Renders nothing for an unknown/empty code. */

// A few non-standard codes that may appear in data, mapped to what flag-icons expects.
const ALIAS: Record<string, string> = { uk: 'gb', el: 'gr' };

export function Flag({ code, className, title }: { code?: string | null; className?: string; title?: string }) {
  const raw = (code ?? '').trim().toLowerCase();
  const c = ALIAS[raw] ?? raw;
  if (!/^[a-z]{2}$/.test(c)) return null;
  return (
    <span
      className={`fi fi-${c} inline-block shrink-0 rounded-[2px] align-middle ring-1 ring-black/10 ${className ?? ''}`}
      style={{ width: '1.25rem', height: '0.9375rem', backgroundSize: 'cover' }}
      title={title ?? code!.toUpperCase()}
      aria-hidden
    />
  );
}

/** Flag + name, the standard way a country is shown across the app. */
export function CountryTag({ code, name, className }: { code?: string | null; name?: string | null; className?: string }) {
  if (!code && !name) return <span className="text-n-400">—</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <Flag code={code} />
      {name != null && <span className="truncate">{name}</span>}
    </span>
  );
}
