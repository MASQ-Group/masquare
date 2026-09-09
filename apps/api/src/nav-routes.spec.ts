import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every link in the sidebar goes somewhere.
 *
 * This exists because a nav item was added without its route. Nothing caught it: an unused page
 * component is not a type error, the bundle built clean, and the tests passed — so the only symptom
 * was the router falling through to the dashboard. Clicking "Shipments Tracking" showed Overview,
 * which reads as a broken page rather than a missing line.
 *
 * A sidebar entry is a promise that a page exists. This checks the promise against the router.
 */

const WEB = join(__dirname, '..', '..', 'web', 'src');

/** Where the sidebar says you can go. */
function navDestinations(): string[] {
  const shell = readFileSync(join(WEB, 'components', 'AppShell.tsx'), 'utf8');
  return [...new Set([...shell.matchAll(/\bto:\s*'(\/[^']*)'/g)].map((m) => m[1]))];
}

/**
 * Every path the router can serve, with nesting resolved.
 *
 * Nested routes are relative — `path="sales"` inside `path="/analytics"` serves /analytics/sales —
 * so a flat scan for `path="…"` would report five real analytics pages as missing. The stack tracks
 * which routes are still open: a tag ending `/>` is a leaf, one ending `>` has children.
 */
function routePaths(): Set<string> {
  const app = readFileSync(join(WEB, 'App.tsx'), 'utf8');
  const paths = new Set<string>();
  const stack: string[] = [];

  for (const line of app.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('</Route>')) { stack.pop(); continue; }
    if (!trimmed.startsWith('<Route')) continue;

    const path = /path="([^"]*)"/.exec(trimmed)?.[1];
    const selfClosing = trimmed.endsWith('/>');
    const full = path == null
      ? stack[stack.length - 1] ?? ''
      : path.startsWith('/') ? path : `${(stack[stack.length - 1] ?? '').replace(/\/$/, '')}/${path}`;

    if (full) paths.add(full);
    // `index` routes serve the parent path, which the parent already added.
    if (!selfClosing) stack.push(full);
  }
  return paths;
}

describe('sidebar navigation', () => {
  it('finds the navigation and the router', () => {
    expect(navDestinations().length).toBeGreaterThan(20);
    expect(routePaths().size).toBeGreaterThan(20);
  });

  it('has a route behind every link', () => {
    const paths = routePaths();
    const dead = navDestinations().filter((to) => {
      if (paths.has(to)) return false;
      /**
       * A wildcard parent covers everything beneath it — but the CATCH-ALL covers nothing.
       *
       * `path="*"` is the fallback that redirects an unknown URL to the dashboard, and it resolves
       * to `/*`. Counting it as coverage made this test vacuous: every link in the sidebar matched
       * it, including the one with no page behind it. The catch-all is the mechanism by which a
       * missing route becomes "the Overview page", so it is the last thing that may excuse one.
       */
      return ![...paths].some((p) => p.endsWith('/*') && p.length > 2 && to.startsWith(p.slice(0, -2)));
    });
    expect(
      dead,
      'These sidebar links have no route in App.tsx, so they fall through to the dashboard.\n',
    ).toEqual([]);
  });
});
