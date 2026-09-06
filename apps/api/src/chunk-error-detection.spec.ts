import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A route that fails to load must never leave a blank screen.
 *
 * Every page is a lazy `import()`, and each deploy renames the hashed chunk files. A tab left open
 * across a deploy asks for a file the server no longer has: the import rejects, and with nothing
 * catching it React unmounts the whole tree. The user sees white, and reloading fixes it — which
 * is exactly what was reported, after six deploys in one day.
 *
 * The detector has to recognise the failure across browsers, because the wording is not
 * standardised — Chrome, Firefox and Safari each phrase it differently, and matching only the one
 * on the developer's machine would leave the other two blank.
 */

// Read the shipped source rather than importing it: the component is TSX with React imports and
// this suite has no DOM environment. The regex is the part that must be right.
const source = readFileSync(
  join(__dirname, '..', '..', 'web', 'src', 'components', 'common', 'RouteBoundary.tsx'),
  'utf8',
);
const pattern = new RegExp(
  source.match(/return \/(.+?)\/i\.test\(/s)![1],
  'i',
);

const detects = (message: string) => pattern.test(`Error: ${message}`);

describe('recognising a stale chunk', () => {
  it('catches the wording each browser uses', () => {
    // Chrome / Edge
    expect(detects('Failed to fetch dynamically imported module: https://…/assets/ProductsPage-a1b2c3.js')).toBe(true);
    // Firefox
    expect(detects('error loading dynamically imported module')).toBe(true);
    // Safari
    expect(detects('Importing a module script failed.')).toBe(true);
    // Webpack-era bundlers, still seen behind some proxies
    expect(detects('ChunkLoadError: Loading chunk 42 failed')).toBe(true);
    expect(detects('Loading chunk 7 failed')).toBe(true);
  });

  it('does not claim an ordinary render error is a stale chunk', () => {
    // These must fall through to the readable panel, NOT trigger a reload — reloading a genuine
    // bug just hides it behind a flicker.
    expect(detects("Cannot read properties of undefined (reading 'map')")).toBe(false);
    expect(detects('Objects are not valid as a React child')).toBe(false);
    expect(detects('Request failed with status code 500')).toBe(false);
    expect(detects('Network Error')).toBe(false);
  });

  it('is guarded against reloading in a loop', () => {
    // A broken build would otherwise refresh forever, which is harder to diagnose than a page
    // that simply says what went wrong.
    expect(source).toMatch(/RELOAD_COOLDOWN_MS/);
    expect(source).toMatch(/sessionStorage\.setItem\(RELOAD_FLAG/);
  });

  it('renders something in every branch, so the screen is never blank', () => {
    expect(source).toMatch(/Updating to the latest version/);
    expect(source).toMatch(/This page could not be loaded/);
    expect(source).toMatch(/This page stopped working/);
  });
});
