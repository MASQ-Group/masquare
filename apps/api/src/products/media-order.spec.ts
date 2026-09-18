import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every query that reads a product's images reads them in the platform's order.
 *
 * "First is featured" is the rule on the product page, and "Make featured" keeps it by rewriting
 * sortOrder. The eBay listing read the same images by upload time instead, so a product whose
 * featured image was picked after upload went to eBay led by whichever picture was uploaded first —
 * and eBay makes the first image the listing's main one.
 *
 * This reads the source, the way the soft-delete and route-coverage checks do: the failure is an
 * orderBy that was never written, and no runtime test can look for absence. Any query that selects
 * image URLs must order by sortOrder first.
 */

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [path] : [];
  });
}

/** The `{ ... }` starting at `start`, braces balanced. */
function block(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/** Every `media: { ... }` include that reads image URLs — whole-row or `url: true`. */
function mediaReads() {
  return sourceFiles(SRC).flatMap((path) => {
    const file = readFileSync(path, 'utf8');
    const found: { path: string; line: number; body: string }[] = [];
    for (const m of file.matchAll(/\bmedia:\s*\{/g)) {
      const body = block(file, m.index! + m[0].length - 1);
      // A query that selects only ids is counting images, not showing them; order is irrelevant.
      const selectsOnlyIds = /select:\s*\{\s*id:\s*true\s*\}/.test(body);
      if (!body.includes('deletedAt') || selectsOnlyIds) continue;
      found.push({ path, line: file.slice(0, m.index!).split('\n').length, body });
    }
    return found;
  });
}

describe('product images are read in the platform’s order', () => {
  const reads = mediaReads();

  it('finds the image queries at all, so a pass means something', () => {
    expect(reads.length).toBeGreaterThanOrEqual(5);
  });

  it('orders every one by sortOrder first, so the featured image leads', () => {
    const wrong = reads
      .filter(({ body }) => {
        const order = /orderBy:\s*(\[[^\]]*\]|\{[^}]*\})/.exec(body)?.[1] ?? '';
        // sortOrder must be the first key the order names.
        return !/^[[{]\s*\{?\s*sortOrder\b/.test(order);
      })
      .map(({ path, line }) => `${path.replace(SRC, 'src')}:${line}`);
    expect(wrong).toEqual([]);
  });
});
