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

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
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
  it('finds the controllers', () => {
    // A guard against this whole file silently passing because the walk broke.
    expect(FILES.length).toBeGreaterThan(30);
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
      // The caller's own access set and the catalogue of what CAN be granted — neither reveals
      // anything about anyone else.
      '/access/access.controller.ts',
      // Signing in, and reading your own profile. There is no grant to check yet.
      '/auth/auth.controller.ts',
      // Liveness probe, called by the platform rather than a person.
      '/health.controller.ts',
      // eBay's webhook. It arrives with no user at all; its signature check is the gate.
      '/integrations/ebay-notifications.controller.ts',
      // Progress of a job the caller already started; the work was authorised when it began.
      '/jobs/jobs.controller.ts',
    ]);
  });
});
