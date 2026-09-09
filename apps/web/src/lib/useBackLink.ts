import { useLocation } from 'react-router-dom';
import { navLabelFor } from '../components/AppShell';

/**
 * Getting back to where you came from.
 *
 * A link that crosses modules leaves you somewhere whose own breadcrumb points at ITS list, not at
 * yours. Open an order from Shipments Tracking and the trail reads SALES › Sales Transactions —
 * true, and useless: it offers a way to a page you were not on. The browser's back button works,
 * but nothing on screen says so, and after a save the history has moved on anyway.
 *
 * So the origin travels in the URL as `?from=`, and the destination offers a labelled way back.
 *
 * In the URL rather than router state, deliberately. Router state is the tidier mechanism and it
 * dies on refresh: reload the order you were editing and the way back silently disappears — the
 * one moment somebody is most likely to want it. A query parameter survives a reload, a bookmark,
 * and a link pasted to a colleague.
 *
 * Chosen over opening a new tab, which was the fallback asked about. A new tab per row leaves a
 * trail of windows to close and loses the company switcher's context on every one; and the app is
 * a place people work for hours, so it should not shed tabs as they read.
 */
export interface BackLink {
  href: string;
  label: string;
}

/** The parameter name, in one place — it is written by links and read here. */
export const RETURN_PARAM = 'from';

/**
 * Build a destination that remembers where it was opened from.
 *
 * `from` carries the path AND the query string, so returning lands on the list as it was — the same
 * filter, the same search — rather than at its default view.
 */
export function withReturn(to: string, from: { pathname: string; search: string }): string {
  const origin = `${from.pathname}${from.search}`;
  const separator = to.includes('?') ? '&' : '?';
  return `${to}${separator}${RETURN_PARAM}=${encodeURIComponent(origin)}`;
}

/**
 * Only an internal path is ever accepted.
 *
 * A single leading slash and nothing that could be read as another host: `//evil.example` and
 * `https://…` are both paths a browser would happily leave the app for, and this value arrives from
 * the address bar where anyone can type it.
 */
export function isInternalPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes(':');
}

/** Where this page was opened from, if it was opened from anywhere. Null otherwise. */
export function useBackLink(): BackLink | null {
  const location = useLocation();
  const raw = new URLSearchParams(location.search).get(RETURN_PARAM);
  if (!raw || !isInternalPath(raw)) return null;

  /**
   * The label comes from the navigation, not from the URL.
   *
   * Passing it alongside the path would work and would also let the address bar dictate what a
   * button in our own chrome says. Reading it from the sidebar means the name is always the real
   * one, and it cannot drift when a page is renamed.
   */
  const label = navLabelFor(raw.split('?')[0]);
  return label ? { href: raw, label } : null;
}
