import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The two companies never appear together on a channel page.
 *
 * A.M.A. MASQUARE and N.K. MULTITRADE are separate legal entities with separate seller accounts,
 * and most of the same marketplaces exist under both. A read that does not name a company
 * therefore returns two of everything — two Amazon DE, two Amazon FR — indistinguishable on
 * screen, with the caller's own no more obvious than the other company's. That is exactly how the
 * product Channels tab came to list every marketplace twice and read as duplicated data.
 *
 * On a write it is worse than untidy: an integration id is enough to reach a channel, so an
 * unscoped write can act on the other company's seller account.
 *
 * This pins the boundary at the EDGE — the controllers, where a user's request arrives.
 * Background work (sync, the repricer, the SQS poller) runs with no user, per integration, and
 * must NOT be scoped by anyone's company list. Scope at the edge, never in the engine.
 *
 * ── Why there is a debt list below ──────────────────────────────────────────────────────────────
 * Thirty-four routes predate the rule. Fixing them is real work — each needs its service changed
 * too, and several are genuinely platform-wide — so they are written down rather than either
 * silently tolerated or mass-annotated in one careless sweep, which is precisely how the access
 * guard came to miss eight controllers.
 *
 * The list may only shrink. A new unscoped route fails immediately; a fixed one is deleted from
 * here. When it empties, delete the list and the rule stands unqualified.
 */

const SRC = join(__dirname, '..');

/** Controllers that reach channel integrations, listings or pushes on a user's behalf. */
const CHANNEL_CONTROLLERS = [
  'listing/listing.controller.ts',
  'listing/amazon/amazon-listing.controller.ts',
  'listing/ebay/ebay-listing.controller.ts',
  'channel-listings/channel-listings.controller.ts',
  'integrations/integrations.controller.ts',
];

/**
 * Routes that legitimately take no company, because no seller account is involved.
 * These are permanent, not debt.
 */
const EXEMPT: Record<string, string> = {
  marketplaceProfiles: 'mains voltage and plug facts per market — describes the market, not an account',
  updateProfile: 'edits that same platform-wide reference data; admin-only',
  connectors: 'the catalogue of connector types we support; nothing account-specific',
  channelLogos: 'logos per channel TYPE, shared by both companies',
  setChannelLogo: 'a logo belongs to the channel type, not to a seller account',
  removeChannelLogo: 'removes that same shared channel-type logo; no account involved',
};

/**
 * Known unscoped routes, awaiting the work. Ordered as the audit found them.
 *
 * Every line here is a route where the caller's company is not named, so it can reach or mix both
 * seller accounts. Nothing may be added; each is removed as it is fixed.
 */
const KNOWN_UNSCOPED = [
  'channel-listings/channel-listings.controller.ts → restoreQuantities()',
  'integrations/integrations.controller.ts → backfillCancelStages()',
  'integrations/integrations.controller.ts → bulkSetAutoSync()',
  'integrations/integrations.controller.ts → createEbaySigningKey()',
  'integrations/integrations.controller.ts → ebayOrderMoney()',
  'integrations/integrations.controller.ts → ebayOrderMoneyDefault()',
  'integrations/integrations.controller.ts → getSyncSettings()',
  'integrations/integrations.controller.ts → previewListings()',
  'integrations/integrations.controller.ts → previewMapping()',
  'integrations/integrations.controller.ts → previewOrders()',
  'integrations/integrations.controller.ts → repairAmazonFees()',
  'integrations/integrations.controller.ts → setSyncSettings()',
  'integrations/integrations.controller.ts → setupSpApiNotifications()',
  'integrations/integrations.controller.ts → sync()',
  'integrations/integrations.controller.ts → test()',
  'integrations/integrations.controller.ts → verifyMapping()',
  'listing/amazon/amazon-listing.controller.ts → candidates()',
  'listing/amazon/amazon-listing.controller.ts → competition()',
  'listing/amazon/amazon-listing.controller.ts → preview()',
  'listing/amazon/amazon-listing.controller.ts → quote()',
  'listing/amazon/amazon-listing.controller.ts → state()',
  'listing/amazon/amazon-listing.controller.ts → status()',
  'listing/amazon/amazon-listing.controller.ts → submit()',
  'listing/ebay/ebay-listing.controller.ts → createLocation()',
  'listing/ebay/ebay-listing.controller.ts → diagnose()',
  'listing/ebay/ebay-listing.controller.ts → prerequisites()',
  'listing/ebay/ebay-listing.controller.ts → preview()',
  'listing/ebay/ebay-listing.controller.ts → publish()',
  'listing/ebay/ebay-listing.controller.ts → withdraw()',
  'listing/listing.controller.ts → removePlan()',
];

function handlersOf(source: string): { name: string; signature: string }[] {
  const out: { name: string; signature: string }[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*@(Get|Post|Patch|Put|Delete)\(/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && /^\s*@/.test(lines[j])) j++;
    const sig: string[] = [];
    for (let k = j; k < lines.length && k < j + 14; k++) {
      sig.push(lines[k]);
      if (lines[k].includes('{')) break;
    }
    const name = /^\s*(?:async\s+)?(\w+)\s*\(/.exec(sig[0] ?? '')?.[1];
    if (name) out.push({ name, signature: sig.join(' ') });
  }
  return out;
}

const SCOPING = /@(VisibleCompanies|WriteCompany|ActiveCompany|AllowedCompanies)\(/;

function unscopedRoutes(): string[] {
  const out: string[] = [];
  for (const rel of CHANNEL_CONTROLLERS) {
    const source = readFileSync(join(SRC, rel), 'utf8');
    for (const { name, signature } of handlersOf(source)) {
      if (EXEMPT[name]) continue;
      if (!SCOPING.test(signature)) out.push(`${rel} → ${name}()`);
    }
  }
  return out.sort();
}

describe('channel endpoints name a company', () => {
  it('reads every controller in the list', () => {
    for (const rel of CHANNEL_CONTROLLERS) {
      expect(() => statSync(join(SRC, rel)), `${rel} — has it moved?`).not.toThrow();
    }
  });

  it('adds no new route that can reach both seller accounts', () => {
    const surprises = unscopedRoutes().filter((r) => !KNOWN_UNSCOPED.includes(r));
    expect(
      surprises,
      'These channel routes take no company, so they can mix or cross the two seller accounts.\n' +
        'Add @VisibleCompanies() for a read or @WriteCompany() for a write.\n\n  ' +
        surprises.join('\n  ') +
        '\n',
    ).toEqual([]);
  });

  it('only ever shrinks the debt list', () => {
    // A route fixed but left listed here would make the list lie, and a lying list stops being
    // read. Removing the line is part of fixing the route.
    const still = unscopedRoutes();
    const staleEntries = KNOWN_UNSCOPED.filter((r) => !still.includes(r));
    expect(
      staleEntries,
      `These are scoped now — delete them from KNOWN_UNSCOPED:\n  ${staleEntries.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('states how much is left, so the debt is a number and not a feeling', () => {
    expect(KNOWN_UNSCOPED.length).toBe(30);
  });

  it('gives every permanent exemption a real reason', () => {
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${name} needs a reason worth reading`).toBeGreaterThan(20);
    }
  });
});
