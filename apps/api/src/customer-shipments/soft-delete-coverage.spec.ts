import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every read of a customer shipment must filter out the deleted ones.
 *
 * Deleting a shipment is soft, per the platform's rule against hard deletes — which means the
 * delete does not itself hide anything. What hides it is that every query filters on deletedAt, in
 * the two staff queues, the portal's list, the pending badge and the tracking sweep alike. Miss one
 * and a shipment somebody deleted comes back in exactly one place, which is a far more confusing
 * bug than it never having gone.
 *
 * So this reads the source rather than the behaviour: a new query added anywhere in the API fails
 * here unless it says what it does about deleted rows. The same reasoning as route-coverage — the
 * failure mode is a thing that was not written, and no runtime test can look for absence.
 *
 * It reads the call's own arguments, following a `where` built in a variable just above. An earlier
 * version scanned a window of nearby lines and was worthless: a deliberately unfiltered query added
 * for the purpose passed, because the method underneath it happened to mention deletedAt.
 *
 * One query is legitimately allowed to see deleted rows, and says so in a comment above itself. It
 * asks whether a reference string is free, and the unique index the database enforces counts
 * deleted rows — so a check that skipped them would hand back a reference Postgres refuses a moment
 * later. The exemption is written at the call site rather than listed here, because a list of
 * blessed line numbers in a test file is a thing nobody maintains.
 */

const SRC = join(__dirname, '..');
const READS = /\bcustomerShipment\.(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy)\s*\(/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [path] : [];
  });
}

/** What a query writes above itself to say that seeing deleted rows is the point. */
const DELIBERATE = 'Deleted rows included on purpose';

/** The text between `open` and its matching close, starting at the opening bracket. */
function balanced(text: string, start: number, open: string, close: string): string {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/**
 * Whether this call filters on deletedAt — directly, or through a `where` built just above it.
 *
 * `count({ where })` is the case that matters: the object was assembled a few lines up and shared
 * with the findMany beside it, and refusing that shape would only teach people to inline it.
 */
function filtersDeleted(file: string, callArgs: string): boolean {
  if (callArgs.includes('deletedAt')) return true;

  // `where: something` or the `{ where }` shorthand.
  const named = callArgs.match(/where:\s*([A-Za-z_$][\w$]*)/);
  const shorthand = /\{\s*where\s*[,}]/.test(callArgs);
  const variable = named?.[1] ?? (shorthand ? 'where' : null);
  if (!variable) return false;

  const declaration = new RegExp(`(?:const|let|var)\\s+${variable}\\s*(?::[^=]+)?=\\s*\\{`).exec(file);
  if (!declaration) return false;
  const braceAt = file.indexOf('{', declaration.index + declaration[0].length - 1);
  return balanced(file, braceAt, '{', '}').includes('deletedAt');
}

describe('soft-deleted customer shipments stay hidden', () => {
  const callSites = sourceFiles(SRC).flatMap((path) => {
    const file = readFileSync(path, 'utf8');
    const found: { path: string; line: number; args: string; file: string; exempt: boolean }[] = [];
    for (const match of file.matchAll(READS)) {
      const parenAt = match.index! + match[0].length - 1;
      const before = file.slice(0, match.index!).split('\n');
      found.push({
        path,
        line: before.length,
        args: balanced(file, parenAt, '(', ')'),
        file,
        // The declaration has to be right above the call, in its own comment block.
        exempt: before.slice(-16).join('\n').includes(DELIBERATE),
      });
    }
    return found;
  });

  it('finds the queries at all, so a passing run means something', () => {
    // If a rename ever makes this pattern match nothing, the suite would go green by finding no
    // work to do. It has to fail instead.
    expect(callSites.length).toBeGreaterThanOrEqual(8);
  });

  it('filters deletedAt at every one of them', () => {
    const unguarded = callSites
      .filter(({ file, args, exempt }) => !exempt && !filtersDeleted(file, args))
      .map(({ path, line }) => `${path.replace(SRC, 'src')}:${line}`);

    expect(unguarded).toEqual([]);
  });

  it('has exactly one query that deliberately sees deleted rows', () => {
    // Stated as a number so that a second exemption has to be a deliberate edit to this test, read
    // by whoever is reviewing it, rather than a comment pasted from somewhere else.
    const exempt = callSites.filter((c) => c.exempt).map(({ path, line }) => `${path.replace(SRC, 'src')}:${line}`);
    expect(exempt).toHaveLength(1);
  });

  it('would notice a query that did not filter', () => {
    // The guard above is only worth having if it can fail, and the first version of it could not.
    const pretend = 'const where = { status: "FULFILLED" };';
    expect(filtersDeleted(pretend, '({ where })')).toBe(false);
    expect(filtersDeleted(pretend, '({ where: { status: "FULFILLED" } })')).toBe(false);
    expect(filtersDeleted('const where = { deletedAt: null };', '({ where })')).toBe(true);
    expect(filtersDeleted('', '({ where: { deletedAt: null } })')).toBe(true);
  });
});
