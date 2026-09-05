import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { AREA_KEYS, CAPABILITY_KEYS } from './catalogue';

/**
 * Every controller must say what it needs.
 *
 * The guard denies anything undeclared, so a missing declaration is safe — but it fails at request
 * time, for whoever happens to hit that route first, which could be a customer-facing action on a
 * Friday. This finds it at build time instead.
 *
 * It reads the source rather than booting Nest deliberately: the question is whether a human wrote
 * the declaration, and a static answer to that cannot itself be fooled by wiring.
 */

const SRC = join(__dirname, '..');

/**
 * Every file that declares a controller — found by looking for `@Controller(`, not by trusting the
 * filename.
 *
 * This used to glob `*.controller.ts`, and three files do not follow that convention:
 * `global-data.controllers.ts` (plural) and two in global-settings named after what they contain.
 * Between them they hold eight controllers and 34 routes — countries, shipping services, sales
 * channels, profit tiers, brands, product types, fulfilment types and compliance options — none of
 * which were annotated, all of which the guard therefore refused. Every one of those screens came
 * up empty, and it read as data loss.
 *
 * The filename convention is not enforced anywhere, so a test that relies on it is checking the
 * wrong thing. This reads the source.
 */
function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && readFileSync(full, 'utf8').includes('@Controller(')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Each controller class, paired with the whole block of decorators above it.
 *
 * Walked upward line by line rather than matched from `@Controller` downward, because decorator
 * order is arbitrary — `@NoAccessCheck()` sits above `@Controller()` on one of these and a
 * downward match silently missed it, which is a false pass in a test whose entire job is to catch
 * an omission.
 */
function declarations(source: string): { className: string; decorators: string }[] {
  const lines = source.split(/\r?\n/);
  const out: { className: string; decorators: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^export class (\w+)/.exec(lines[i]);
    if (!m) continue;
    const block: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const l = lines[j].trim();
      if (l.startsWith('@') || l.startsWith('//') || l.startsWith('*') || l.startsWith('/*') || l === '') block.push(l);
      else break;
    }
    // Only classes that are actually controllers.
    if (block.some((l) => l.startsWith('@Controller'))) out.push({ className: m[1], decorators: block.join('\n') });
  }
  return out;
}

const FILES = controllerFiles(SRC);

describe('access declarations', () => {
  it('finds every controller class in the source tree', () => {
    // Counted, not bounded. `toBeGreaterThan(30)` passed happily with 42 files while three were
    // missing entirely — a floor cannot notice an omission above it. If this number moves, a
    // controller was added or removed and somebody should say which.
    const classes = FILES.reduce((n, f) => n + declarations(readFileSync(f, 'utf8')).length, 0);
    expect(classes, `Controller classes found across ${FILES.length} files`).toBe(56);
  });

  it('declares an area or an explicit exemption on every controller', () => {
    const undeclared: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      for (const { className, decorators } of declarations(source)) {
        const has = decorators.includes('@AccessArea(') || decorators.includes('@NoAccessCheck()');
        if (!has) undeclared.push(`${file.replace(SRC, '')} → ${className}`);
      }
    }
    expect(undeclared, `Add @AccessArea(...) or @NoAccessCheck() to:\n  ${undeclared.join('\n  ')}`).toEqual([]);
  });

  it('names only areas the catalogue knows', () => {
    // A typo would otherwise produce a route nobody can ever reach, and the symptom would be a
    // permission bug rather than a spelling one.
    const bad: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/@AccessArea\(([^)]*)\)/g)) {
        for (const raw of m[1].split(',')) {
          const key = raw.trim().replace(/^['"]|['"]$/g, '');
          if (key && !AREA_KEYS.includes(key)) bad.push(`${file.replace(SRC, '')}: "${key}"`);
        }
      }
    }
    expect(bad, `Unknown areas:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('names only capabilities the catalogue knows', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/@RequireCapability\('([^']*)'\)/g)) {
        if (!CAPABILITY_KEYS.includes(m[1])) bad.push(`${file.replace(SRC, '')}: "${m[1]}"`);
      }
    }
    expect(bad, `Unknown capabilities:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('keeps the exemption list short and deliberate', () => {
    // Every exemption is a route with no permission check at all. The list is asserted rather than
    // counted so that adding one is a decision somebody has to make here, in the open, rather than
    // a decorator quietly appearing in a controller.
    const exempt = FILES.filter((f) => readFileSync(f, 'utf8').includes('@NoAccessCheck()'))
      .map((f) => f.replace(SRC, '').replace(/\\/g, '/'))
      .sort();
    expect(exempt).toEqual([
      // Sorted, so these read in path order rather than in the order anyone happened to add them.

      // The caller's own access set and the catalogue of what CAN be granted — neither reveals
      // anything about anyone else.
      '/access/access.controller.ts',
      // Signing in, and reading your own profile. There is no grant to check yet.
      '/auth/auth.controller.ts',
      // The three below exempt their READ routes only — country, carrier, channel, brand, product
      // type, fulfilment type and compliance lists, which nearly every form needs and which say
      // nothing worth withholding. Their writes still require Global settings.
      '/global-data/global-data.controllers.ts',
      '/global-settings/compliance-options.ts',
      '/global-settings/simple-refs.ts',
      // Liveness probe, called by the platform rather than a person.
      '/health.controller.ts',
      // eBay's webhook. It arrives with no user at all; its signature check is the gate.
      '/integrations/ebay-notifications.controller.ts',
      // Progress of a job the caller already started; the work was authorised when it began.
      '/jobs/jobs.controller.ts',
    ]);
  });
});
