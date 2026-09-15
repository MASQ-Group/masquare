/**
 * Point the open page's tab icon at the current favicon.
 *
 * index.html asks for it once, on load. After an admin uploads or removes one, this re-asks with a
 * fresh query string, so the tab updates straight away instead of on the next reload — and so the
 * browser cannot answer from its cache of the previous icon.
 */
export function refreshFavicon(hasIcon: boolean) {
  const existing = document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
  existing.forEach((l) => l.remove());
  if (!hasIcon) return;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = `/api/settings/favicon?v=${Date.now()}`;
  document.head.appendChild(link);
}
