import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every page's breadcrumb names a real place, in the same shape.
 *
 * The trail is SECTION › Page › Record, and each part means something specific:
 *
 *   SECTION — the sidebar GROUP the page sits in. Not a link: a group is not a page.
 *   Page    — the sidebar ITEM. Links, so a record can get back to the list it came from.
 *   Record  — the thing being looked at. Detail pages only.
 *
 * Two things went wrong before this test existed. The Channel Listings detail page read
 * "SALES CHANNELS › Victorinox Swiss Army Knife", skipping the page the record actually lives on,
 * so the trail lied about where you were and offered no way back to the list. And the Activity page
 * announced a section called "Platform", which has never existed in the sidebar.
 *
 * Both are the same failure: a breadcrumb is a claim about the app's structure, and nothing was
 * checking the claim against the structure.
 */

const WEB = join(__dirname, '..', '..', 'web', 'src');

/** The sidebar's own groups, read from the navigation rather than copied. */
function navGroups(): string[] {
  const shell = readFileSync(join(WEB, 'components', 'AppShell.tsx'), 'utf8');
  const block = shell.slice(shell.indexOf('const NAV_GROUPS'));
  // Group labels are the `label:` directly inside each group object, before its `items:`.
  return [...block.matchAll(/\{\s*\n\s*label: '([^']+)',\s*\n\s*items:/g)].map((m) => m[1]);
}

/** Every `module="..."` a page header declares, with the file it came from. */
function declaredModules(): { file: string; module: string }[] {
  const out: { file: string; module: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.tsx')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('<PageHeader')) continue;
      for (const m of src.matchAll(/<PageHeader[\s\S]{0,400}?module="([^"]+)"/g)) {
        out.push({ file: name, module: m[1] });
      }
    }
  };
  walk(join(WEB, 'pages'));
  walk(join(WEB, 'components'));
  return out;
}

describe('breadcrumbs', () => {
  it('finds the navigation and the pages', () => {
    expect(navGroups().length).toBeGreaterThan(5);
    expect(declaredModules().length).toBeGreaterThan(20);
  });

  it('names a section that actually exists in the sidebar', () => {
    // "Home" is the ungrouped dashboard, which sits above the groups and has no header of its own.
    const allowed = new Set([...navGroups(), 'Home']);
    const strays = declaredModules().filter((d) => !allowed.has(d.module));
    expect(
      strays.map((s) => `${s.file}: module="${s.module}"`),
      'These pages claim a section the sidebar does not have. Use the group the page sits in.\n' +
        `Known sections: ${[...allowed].join(', ')}\n`,
    ).toEqual([]);
  });

  it('gives a detail page the list it belongs to, not just its section', () => {
    // A detail page is one that renders a record fetched by id. Recognised here by taking a route
    // param — which is exactly the set of pages that need the middle crumb.
    const detail = ['ChannelListingDetailPage.tsx', 'PurchaseOrderDetailPage.tsx'];
    for (const name of detail) {
      const src = readFileSync(join(WEB, 'pages', name), 'utf8');
      expect(src, `${name} should carry a parent crumb so the trail is SECTION > Page > Record`)
        .toMatch(/parent=\{\{\s*label:/);
      // The old shape put the LIST route on the section crumb, which reads as though the section
      // itself were the page.
      expect(src, `${name} should not put the list route on the section crumb`).not.toMatch(/moduleHref=/);
    }
  });

  it('links the parent crumb, so a record can get back to its list', () => {
    for (const name of ['ChannelListingDetailPage.tsx', 'PurchaseOrderDetailPage.tsx']) {
      const src = readFileSync(join(WEB, 'pages', name), 'utf8');
      expect(src).toMatch(/parent=\{\{\s*label: '[^']+',\s*href: '\/[^']*'\s*\}\}/);
    }
  });
});
