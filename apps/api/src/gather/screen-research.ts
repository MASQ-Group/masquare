/**
 * Checking what Claude brings back before any of it is believed.
 *
 * When Claude researches a product through the maSquare connector it is a WITNESS, not the judge.
 * It reports pages it read and values those pages stated. This module decides which of that is
 * evidence at all — and it decides from the reports themselves, with code that cannot be talked
 * round, before the ordinary provenance rules ever see a finding.
 *
 * Three things are required of every finding, and a finding missing any of them is dropped with a
 * reason rather than kept on trust:
 *
 *   1. It names the page it came from, and that page was DECLARED as a source. A value reported
 *      against an undeclared URL never had its page's identity checked, so it is not evidence.
 *   2. That page states which product it describes — its brand or its part number — and what it
 *      states matches ours. This is the Panasonic that came back branded Marley, caught at the
 *      door: a page about a different product makes every value on it wrong, however plausible.
 *   3. Which KIND of page it is (the maker's own, a marketplace, anywhere else) is decided here from
 *      the URL, never taken from Claude's description of it. A `manufacturer` finding publishes
 *      without a person confirming it, so that label is the most expensive one to get wrong.
 *
 * Pages Claude found are NOT treated like pages a person nominated. A person choosing a page is a
 * judgement the business accepts; a search result is a lead. So a failed identity check here
 * rejects the page outright, where on a nominated page it only warns.
 *
 * PURE.
 */
import type { SourceFinding } from './gather-rules';
import { verifyIdentity } from './identity';
import { classifySourceUrl } from './source-kind';

export interface ResearchedSource {
  url: string;
  /** The brand the page itself shows for the product it describes. */
  pageBrand?: string | null;
  /** The part or model number the page itself shows. */
  pagePartNumber?: string | null;
}

export interface ResearchedFinding {
  field: string;
  value: string;
  sourceUrl: string;
}

export interface ScreenResult {
  accepted: SourceFinding[];
  acceptedSources: Array<{ url: string; kind: SourceFinding['kind'] | 'web'; matchedOn: string[] }>;
  rejectedSources: Array<{ url: string; reason: string }>;
  dropped: Array<{ field: string; value: string; sourceUrl: string; why: string }>;
}

/**
 * Hard ceilings on what one submission may carry. A product has tens of item specifics, not
 * thousands; anything past these is a runaway loop or a malformed call, and truncating it silently
 * would hide which of the two it was — so the caller is told.
 */
export const LIMITS = { sources: 30, findings: 300, field: 80, value: 300, url: 2000 } as const;

/**
 * The same page written two ways — trailing slash, fragment, capitalised host — is one page, so a
 * finding cited against either matches the source that was declared.
 */
export function pageKey(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return null;
  }
}

export function screenResearch(
  product: { brand: string | null; brandWebsite: string | null; mpn: string | null },
  sources: readonly ResearchedSource[],
  findings: readonly ResearchedFinding[],
): ScreenResult {
  const result: ScreenResult = { accepted: [], acceptedSources: [], rejectedSources: [], dropped: [] };

  /** Decided once per page: the key it is known by, and whether its findings may be used. */
  const verdicts = new Map<string, { ok: true; kind: SourceFinding['kind'] | 'web'; url: string } | { ok: false }>();

  for (const s of sources.slice(0, LIMITS.sources)) {
    const url = (s?.url ?? '').trim().slice(0, LIMITS.url);
    const key = pageKey(url);
    if (!key) {
      result.rejectedSources.push({ url, reason: 'that is not an http(s) web address' });
      continue;
    }
    // Declared twice is still one page; the first declaration is the one judged.
    if (verdicts.has(key)) continue;

    const who = verifyIdentity(
      { brand: product.brand, mpn: product.mpn },
      {
        brand: s.pageBrand?.trim() || null,
        mpns: s.pagePartNumber?.trim() ? [s.pagePartNumber.trim()] : [],
        title: null,
      },
    );
    if (!who.ok) {
      verdicts.set(key, { ok: false });
      result.rejectedSources.push({ url, reason: who.reason });
      continue;
    }

    const kind = classifySourceUrl(url, { name: product.brand, website: product.brandWebsite });
    verdicts.set(key, { ok: true, kind, url });
    result.acceptedSources.push({ url, kind, matchedOn: who.matchedOn });
  }

  if (sources.length > LIMITS.sources) {
    result.rejectedSources.push({
      url: `(${sources.length - LIMITS.sources} more)`,
      reason: `only the first ${LIMITS.sources} sources in one submission are read`,
    });
  }

  for (const f of findings.slice(0, LIMITS.findings)) {
    const field = (f?.field ?? '').trim().slice(0, LIMITS.field);
    const value = (f?.value ?? '').trim().slice(0, LIMITS.value);
    const sourceUrl = (f?.sourceUrl ?? '').trim().slice(0, LIMITS.url);

    // Nothing found is not a finding. Left empty, as instructed.
    if (!field || !value) continue;

    const key = pageKey(sourceUrl);
    const verdict = key ? verdicts.get(key) : undefined;
    if (!verdict) {
      result.dropped.push({
        field, value, sourceUrl,
        why: 'its page was not declared as a source, so nothing checked that the page is about this product',
      });
      continue;
    }
    if (!verdict.ok) {
      result.dropped.push({ field, value, sourceUrl, why: 'its page describes a different product' });
      continue;
    }

    result.accepted.push({
      field,
      value,
      kind: verdict.kind as SourceFinding['kind'],
      url: verdict.url,
      label: hostLabel(verdict.url),
    });
  }

  if (findings.length > LIMITS.findings) {
    result.dropped.push({
      field: `(${findings.length - LIMITS.findings} more)`, value: '', sourceUrl: '',
      why: `only the first ${LIMITS.findings} findings in one submission are read`,
    });
  }

  return result;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'that page';
  }
}
