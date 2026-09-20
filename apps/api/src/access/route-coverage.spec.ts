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
    // 69 since ListingPriceController (21 Sep 2026) — eBay and OnBuy price edits, under channel listings.
    expect(classes, `Controller classes found across ${FILES.length} files`).toBe(70);
  });

  it('declares an area, an explicit exemption, or the portal on every controller', () => {
    const undeclared: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      for (const { className, decorators } of declarations(source)) {
        const has = decorators.includes('@AccessArea(')
          || decorators.includes('@NoAccessCheck()')
          // A third kind of declaration, and a narrower one: the portal's routes belong to a
          // customer's own people, whose access is not an area at all. They are scoped by
          // PortalGuard to the customer the signed-in person belongs to, and the platform's guard
          // refuses those accounts everywhere else. Listed below, so adding one stays deliberate.
          || decorators.includes('@PortalRoute()');
        if (!has) undeclared.push(`${file.replace(SRC, '')} → ${className}`);
      }
    }
    expect(undeclared, `Add @AccessArea(...), @NoAccessCheck() or @PortalRoute() to:\n  ${undeclared.join('\n  ')}`).toEqual([]);
  });

  /**
   * The controllers a logistics customer's own people can reach.
   *
   * Asserted by name for the same reason as the exemption list: these are the only routes outside
   * the platform's area checks that an external account may call, and one appearing here should be
   * a decision somebody made in the open rather than a decorator that turned up in a controller.
   */
  it('keeps the portal to its own controllers', () => {
    const portal = FILES.filter((f) => readFileSync(f, 'utf8').includes('@PortalRoute()'))
      .map((f) => f.replace(SRC, '').replace(/\\/g, '/'))
      .sort();
    expect(portal).toEqual([
      // Signing in and reading your own profile — shared with staff, and the only two the portal
      // needs from the platform's own controllers.
      '/auth/auth.controller.ts',
      // The portal itself: every route scoped to the caller's customer by PortalGuard.
      '/portal/portal.controller.ts',
    ]);
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
      // The four below exempt their READ routes only — country, carrier, channel, brand, product
      // type, fulfilment type and compliance lists, which nearly every form needs and which say
      // nothing worth withholding. Their writes still require Global settings.
      // Setting a password from an emailed invitation. Public by necessity — the person holding the
      // link has no account to sign in to yet, which is what the link is for — and the token is the
      // authorisation: 32 random bytes, single-use, a week long, stored only as a hash.
      '/customers/invites.controller.ts',
      '/global-data/global-data.controllers.ts',
      // Brand channel restrictions: the READ is exempt because the listing flow has to raise the
      // warning, and gating it would hide the restriction from the one screen obliged to show it.
      // Recording a restriction is still a Global settings action.
      '/global-settings/brand-restrictions.controller.ts',
      '/global-settings/compliance-options.ts',
      // The browser tab icon. Its READ is exempt — and public — because the browser asks for it on
      // the sign-in page, before anyone is signed in, and it is only an image. Uploading or removing
      // it is still an admin action, as are the platform settings beside it.
      '/global-settings/settings.controller.ts',
      '/global-settings/simple-refs.ts',
      // Liveness probe, called by the platform rather than a person.
      '/health.controller.ts',
      // eBay's webhook. It arrives with no user at all; its signature check is the gate.
      '/integrations/ebay-notifications.controller.ts',
      // Progress of a job the caller already started; the work was authorised when it began.
      '/jobs/jobs.controller.ts',
      // The availability sweep: the READ is exempt because the product page shows how old its
      // stored answers are, which is the same question this reports, asked from a screen that
      // nobody needs Global settings to open. Changing the schedule still requires it.
      '/listing/availability/availability-sweep.controller.ts',
      // The maSquare connector. It arrives with no browser session, so the platform's own guards
      // have nothing to check; the gate is its bearer token, verified on every request in the
      // controller itself. It then acts as one named user, and that user's ordinary company grants
      // still decide what it can reach — so the exemption is from the login guard, not from scoping.
      '/mcp/mcp.controller.ts',
      // A person's own notifications. Nothing here can reach anybody else's — every route is scoped
      // to the signed-in user — so there is no area to check, and the exemption says so out loud
      // rather than leaving the decorator off and looking like an oversight.
      '/notifications/notifications.controller.ts',
    ]);
  });
});
