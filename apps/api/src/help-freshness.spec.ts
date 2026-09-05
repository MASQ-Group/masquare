import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Help pages that no longer describe the code.
 *
 * Documentation does not fail loudly. It goes quietly wrong, and the way you find out is that
 * somebody follows it and gets a different answer from the platform. This repository already has
 * an example: `docs/maSquare_Module1_Foundation_Spec.md` still states that a user may use a module
 * when it is in their module grants — a rule that never enforced anything and has since been
 * replaced entirely by areas, capabilities and roles.
 *
 * So each help page names the source paths it describes and the date it was last checked against
 * them. When those files have changed since, this fails. It does not know whether the page is
 * actually wrong — only that nobody has looked — which is the honest question and a cheap one to
 * answer: reread the page, fix it if it drifted, and move the date.
 */

const REPO = join(__dirname, '..', '..', '..');
const HELP_DIR = join(REPO, 'apps', 'web', 'src', 'help');

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

interface Page {
  file: string;
  title: string;
  covers: string[];
  reviewed?: string;
}

function frontmatter(raw: string): { title?: string; reviewed?: string; covers: string[] } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) return { covers: [] };
  const covers: string[] = [];
  let inCovers = false;
  let title: string | undefined;
  let reviewed: string | undefined;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && inCovers) { covers.push(item[1].trim()); continue; }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    inCovers = pair[1] === 'covers' && pair[2].trim() === '';
    if (pair[1] === 'title') title = pair[2].trim();
    if (pair[1] === 'reviewed') reviewed = pair[2].trim();
  }
  return { title, reviewed, covers };
}

const PAGES: Page[] = markdownFiles(HELP_DIR).map((file) => {
  const fm = frontmatter(readFileSync(file, 'utf8'));
  return { file, title: fm.title ?? file, covers: fm.covers, reviewed: fm.reviewed };
});

/** Last commit date for a path, or null when git cannot answer (a shallow CI clone, say). */
function lastChanged(pathSpec: string): Date | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', pathSpec], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? new Date(out) : null;
  } catch {
    return null;
  }
}

const gitAvailable = lastChanged('package.json') !== null;

describe('help pages', () => {
  it('finds the corpus', () => {
    // Guards against this whole file passing because the directory moved.
    expect(PAGES.length).toBeGreaterThan(0);
  });

  it('gives every page a title and a review date', () => {
    const bad = PAGES.filter((p) => !p.title || !p.reviewed).map((p) => p.file.replace(REPO, ''));
    expect(bad, `Missing title or reviewed:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('points every `covers` entry at something that exists', () => {
    // A path that no longer exists is the loudest possible signal that a page has drifted, and it
    // would otherwise make the staleness check below silently pass.
    const missing: string[] = [];
    for (const page of PAGES) {
      for (const spec of page.covers) {
        // Globs are checked by their fixed prefix; the rest is git's business.
        const fixed = spec.split(/[*?[]/)[0].replace(/\/$/, '');
        if (fixed && !existsSync(join(REPO, fixed))) missing.push(`${page.title} → ${spec}`);
      }
    }
    expect(missing, `These help pages describe paths that no longer exist:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it.skipIf(!gitAvailable)('has been reviewed since the code it describes last changed', () => {
    const stale: string[] = [];
    for (const page of PAGES) {
      if (!page.reviewed || !page.covers.length) continue;
      const reviewed = new Date(`${page.reviewed}T23:59:59Z`);
      for (const spec of page.covers) {
        const changed = lastChanged(spec);
        if (changed && changed > reviewed) {
          stale.push(`${page.title}  (reviewed ${page.reviewed}, ${spec} changed ${changed.toISOString().slice(0, 10)})`);
        }
      }
    }
    expect(
      stale,
      `These help pages describe code that has changed since they were last checked.\n` +
        `Reread the page, correct it if it drifted, then move its \`reviewed:\` date.\n\n  ${stale.join('\n  ')}\n`,
    ).toEqual([]);
  });
});
