/**
 * Platform typography. Two configurable slots — a primary/body font and a monospace
 * (code) font. Choices are curated Google Fonts; the chosen families are loaded on
 * demand and applied by overriding the --font-sans / --font-mono CSS variables.
 */

export interface FontDef {
  /** Stored key (also the CSS family name). */
  name: string;
  /** Full CSS font-family stack with fallbacks. */
  stack: string;
  /** Google Fonts `family=` parameter (with weights), or null for a system font. */
  google: string | null;
}

const SANS_FALLBACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const sans = (name: string, google: string | null): FontDef => ({
  name,
  stack: `'${name}', ${SANS_FALLBACK}`,
  google,
});
const mono = (name: string, google: string | null): FontDef => ({
  name,
  stack: `'${name}', ${MONO_FALLBACK}`,
  google,
});

export const BODY_FONTS: FontDef[] = [
  sans('Inter', 'Inter:wght@400;500;600;700'),
  sans('Roboto', 'Roboto:wght@400;500;700'),
  sans('Open Sans', 'Open+Sans:wght@400;500;600;700'),
  sans('Lato', 'Lato:wght@400;700'),
  sans('Work Sans', 'Work+Sans:wght@400;500;600;700'),
  sans('Poppins', 'Poppins:wght@400;500;600;700'),
  sans('Source Sans 3', 'Source+Sans+3:wght@400;500;600;700'),
  sans('Hanken Grotesk', 'Hanken+Grotesk:wght@400;500;600;700'),
];

export const MONO_FONTS: FontDef[] = [
  mono('JetBrains Mono', 'JetBrains+Mono:wght@400;500;600'),
  mono('Roboto Mono', 'Roboto+Mono:wght@400;500'),
  mono('Fira Code', 'Fira+Code:wght@400;500'),
  mono('IBM Plex Mono', 'IBM+Plex+Mono:wght@400;500;600'),
  mono('Source Code Pro', 'Source+Code+Pro:wght@400;500;600'),
  mono('Space Mono', 'Space+Mono:wght@400;700'),
];

export const DEFAULT_BODY_FONT = 'Inter';
export const DEFAULT_MONO_FONT = 'JetBrains Mono';

const bodyOf = (name: string) => BODY_FONTS.find((f) => f.name === name) ?? BODY_FONTS[0];
const monoOf = (name: string) => MONO_FONTS.find((f) => f.name === name) ?? MONO_FONTS[0];

/** Ensure the Google Fonts stylesheet for a family is present (once per family). */
function ensureFontLink(font: FontDef) {
  if (!font.google) return;
  const id = `gf-${font.name.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  document.head.appendChild(link);
}

/**
 * Apply the platform fonts: load the chosen families and override the CSS variables
 * on :root, which cascade to body text (--font-sans) and code chips (--font-mono).
 * Numbers use --font-sans via the `.mono` utility (see index.css).
 */
export function applyFonts(bodyFont: string, monoFont: string) {
  const body = bodyOf(bodyFont);
  const code = monoOf(monoFont);
  ensureFontLink(body);
  ensureFontLink(code);
  const root = document.documentElement;
  root.style.setProperty('--font-sans', body.stack);
  root.style.setProperty('--font-mono', code.stack);
}
