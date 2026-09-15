/**
 * eBay sometimes sends its explanation as a page of HTML inside a parameter — the top-rated refusal
 * arrived as nested divs, a table and a link. Shown raw it buried the one sentence that mattered.
 */
function plain(raw: string): string {
  return raw
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * eBay's refusal, in full.
 *
 * eBay answers a failed call with a LIST of errors, and the first is often a generic wrapper while
 * the reason sits in a later error or in the `parameters` of the first. Publishing LAG-611474 came
 * back as "Cannot revise listing … may contain improper words, or the listing or seller may be in
 * violation of eBay policy" — a message that names no word and no policy — because only the first
 * error's message was ever shown. Everything eBay said is kept here, in order, with its error id,
 * so the specific reason reaches the person who has to fix it.
 *
 * PURE.
 */
export function ebayErrorText(json: unknown, max = 1200): string {
  const errors = Array.isArray((json as any)?.errors) ? ((json as any).errors as any[]) : [];
  const lines: string[] = [];
  for (const e of errors) {
    const params = (Array.isArray(e?.parameters) ? e.parameters : [])
      .map((p: any) => (typeof p?.value === 'string' ? plain(p.value) : ''))
      // Parameters often repeat the SKU or offer id; only text that says something is kept.
      .filter((v: string) => v && !/^[A-Za-z0-9_-]{1,40}$/.test(v));
    const text = [e?.message, e?.longMessage, ...params]
      .map((t) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : ''))
      .filter(Boolean)
      // eBay often repeats the message as the longMessage; say it once.
      .filter((t, i, all) => all.indexOf(t) === i)
      .join(' — ');
    if (!text) continue;
    const line = `${e?.errorId ? `[${e.errorId}] ` : ''}${text}`;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines.join(' | ').slice(0, max);
}
