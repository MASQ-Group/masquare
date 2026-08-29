import { describe, expect, it } from 'vitest';

/**
 * The listings sync replaces a channel's rows wholesale. That is right when the pull is complete,
 * and destructive when it is not.
 *
 * On 29 Aug 2026 eBay's Inventory API returned one SKU where we held 4,710. The pull was treated as
 * the whole truth and 4,709 listing records were deleted. The listings themselves were never at
 * risk — this destroyed our record of them — but it took the platform's view of an entire channel
 * with it, and with it the evidence needed to repair an earlier incident.
 *
 * The cause was specific (a fallback that only fired on exactly zero) and is fixed at the source.
 * This guard exists because the general case will recur for reasons we cannot enumerate: a scope
 * change, a partial outage, an API that only ever saw a subset. None of them mean the seller has
 * stopped selling.
 *
 * Going stale is recoverable by running the sync again. Deleting is not.
 */

const MIN_LISTINGS_TO_GUARD = 50;
const KEEP_FRACTION = 0.5;

/** The decision the sync makes per integration, before touching anything. */
const wouldReplace = (pulled: number, held: number) =>
  !(held >= MIN_LISTINGS_TO_GUARD && pulled < held * KEEP_FRACTION);

describe('a pull that collapses', () => {
  it('refuses the case that happened: 1 pulled against 4,710 held', () => {
    expect(wouldReplace(1, 4710)).toBe(false);
  });

  it('refuses an empty pull on a stocked channel', () => {
    // The most dangerous shape of all, and the easiest to produce with an expired token.
    expect(wouldReplace(0, 4710)).toBe(false);
  });

  it('refuses a pull that loses most of the catalogue', () => {
    expect(wouldReplace(2000, 4710)).toBe(false);
  });
});

describe('a pull that is plausibly complete', () => {
  it('accepts a steady catalogue', () => {
    expect(wouldReplace(4700, 4710)).toBe(true);
  });

  it('accepts ordinary shrinkage', () => {
    // Listings end all the time; half is the line, and this is well inside it.
    expect(wouldReplace(4000, 4710)).toBe(true);
  });

  it('accepts growth', () => {
    expect(wouldReplace(6000, 4710)).toBe(true);
  });

  it('accepts exactly half, which is not yet implausible', () => {
    expect(wouldReplace(2355, 4710)).toBe(true);
  });
});

describe('channels too small to judge', () => {
  it('lets a small catalogue empty', () => {
    // Below the floor a genuine catalogue can legitimately halve or clear between pulls, and
    // refusing there would be noise that trains people to ignore the guard.
    expect(wouldReplace(0, 49)).toBe(true);
    expect(wouldReplace(1, 20)).toBe(true);
  });

  it('starts guarding at the floor', () => {
    expect(wouldReplace(0, 50)).toBe(false);
  });

  it('allows the first ever pull', () => {
    // Nothing held, so nothing to lose.
    expect(wouldReplace(4710, 0)).toBe(true);
  });
});

describe('what refusing means', () => {
  it('changes nothing rather than writing a partial view', () => {
    // The alternative considered and rejected: merge the pull into what we hold. That silently
    // keeps rows the channel may genuinely have ended, and quietly diverges from the marketplace
    // with no one aware. Refusing is legible: the records stay as they were and someone is told.
    const held = 4710;
    const pulled = 1;
    const outcome = wouldReplace(pulled, held) ? 'replaced' : 'left alone';
    expect(outcome).toBe('left alone');
  });
});

/**
 * The dashboard identifies an eBay column as `${integrationId}:${marketplace}` — one eBay connection
 * spans many marketplaces and each gets its own column. Those ids reach the sync when an operator
 * picks specific channels, and a composite id against a uuid column fails inside Prisma with a
 * parse error about a character at position 37, which tells an operator nothing.
 *
 * The integration is the unit that can be synced: eBay's pull is account-wide and returns every
 * marketplace at once. So the suffix is dropped and the ids deduped.
 */
const toIntegrationIds = (ids: string[]) =>
  [...new Set(ids.map((id) => id.split(':')[0]).filter(Boolean))];

describe('channel ids arriving from the dashboard', () => {
  const INT = '2f1c9b7e-1111-4a2b-8c3d-4e5f60718293';

  it('reduces an eBay marketplace column to its integration', () => {
    expect(toIntegrationIds([`${INT}:GB`])).toEqual([INT]);
  });

  it('collapses several marketplaces of one connection into one sync', () => {
    // Syncing eBay GB, DE and IT is syncing the eBay account once.
    expect(toIntegrationIds([`${INT}:GB`, `${INT}:DE`, `${INT}:IT`])).toEqual([INT]);
  });

  it('leaves a plain integration id alone', () => {
    // Amazon and OnBuy have one marketplace per connection and pass a bare id.
    expect(toIntegrationIds([INT])).toEqual([INT]);
  });

  it('handles a mixed selection', () => {
    const AMZ = '9a8b7c6d-2222-4e3f-9a1b-2c3d4e5f6071';
    expect(toIntegrationIds([`${INT}:GB`, AMZ, `${INT}:DE`])).toEqual([INT, AMZ]);
  });

  it('drops empty entries rather than matching everything', () => {
    // An empty id in the list must not widen the query to every integration.
    expect(toIntegrationIds(['', ':GB'])).toEqual([]);
  });

  it('treats an empty selection as no selection', () => {
    // Which the caller reads as "sync all", the same as passing nothing.
    expect(toIntegrationIds([])).toEqual([]);
  });
});

/**
 * The product page asks "is this listed on each channel?" by looking each channel's column up
 * among the product's listings. The lookup has to be keyed the way a column is identified.
 *
 * It was keyed by integration id, which names a column only where a connection serves one
 * marketplace. One eBay connection serves eight, so every eBay lookup missed and the page reported
 * "Not listed" on all of them while the dashboard — which keys correctly — showed them listed. Even
 * a matching key would have been wrong: eight rows sharing one integration id collapse into a Map
 * as whichever came last.
 */
const columnKey = (l: { integrationId: string; marketplace: string | null }) =>
  (l.marketplace ? `${l.integrationId}:${l.marketplace}` : l.integrationId);

describe('matching a product listing to its channel column', () => {
  const EBAY = 'aaaaaaaa-1111-4a2b-8c3d-4e5f60718293';
  const AMZ = 'bbbbbbbb-2222-4e3f-9a1b-2c3d4e5f6071';

  const listings = [
    { integrationId: EBAY, marketplace: 'GB', listedQuantity: 1 },
    { integrationId: EBAY, marketplace: 'DE', listedQuantity: 0 },
    { integrationId: EBAY, marketplace: 'IT', listedQuantity: 0 },
    { integrationId: AMZ, marketplace: '', listedQuantity: 4 },
  ];
  const byColumn = new Map(listings.map((l) => [columnKey(l), l]));

  it('keeps every eBay marketplace distinct', () => {
    // The bug: one key for eight markets meant seven rows vanished.
    expect(byColumn.size).toBe(4);
  });

  it('finds the marketplace the column names', () => {
    expect(byColumn.get(`${EBAY}:GB`)?.listedQuantity).toBe(1);
    expect(byColumn.get(`${EBAY}:DE`)?.listedQuantity).toBe(0);
  });

  it('reports listed for a marketplace holding no stock', () => {
    // Out of stock is still listed. Conflating the two is what made 2E-KDM120-PBL read as absent
    // from markets it is live on.
    expect(!!byColumn.get(`${EBAY}:IT`)).toBe(true);
  });

  it('still matches a single-marketplace channel by its bare id', () => {
    expect(byColumn.get(AMZ)?.listedQuantity).toBe(4);
  });

  it('reports not listed only when there is genuinely no row', () => {
    expect(byColumn.get(`${EBAY}:US`)).toBeUndefined();
  });
});

/**
 * Restoring the listings our pushes emptied, using the origin marketplace's figure.
 *
 * eBaymag fans a UK listing out to seven other markets and syncs on change. Our pushes zeroed the
 * fanned-out copies and never touched UK, and eBaymag has not re-pushed in the nine days since — so
 * the origin still holds the right number while its children sit at zero. It has no force-sync, so
 * the only route is to write the children ourselves.
 *
 * The origin figure beats the push audit's on both counts: it is today's rather than the 20th's, and
 * it is what eBaymag itself would publish.
 *
 * Mirroring decides the VALUE. It must never decide eligibility — of the 1,135 eBay listings at zero
 * only 696 were emptied by us; 390 were already at zero and 47 were never ours, and refilling those
 * from a sibling would put stock on sale that nobody said was there.
 */
type Row = { stored: number; recovered: number; mirrored: number };

function planRow(r: Row, mirroring: boolean, onlyDamaged: boolean) {
  const damaged = r.recovered > 0;
  const target = mirroring && r.mirrored > 0
    ? r.mirrored
    : r.stored > 0 ? r.stored : r.recovered > 0 ? r.recovered : 0;
  const source = mirroring && r.mirrored > 0 ? 'origin marketplace'
    : target === 0 ? 'none' : r.stored > 0 ? 'last sync' : 'push audit';
  const included = onlyDamaged ? damaged && target > 0 : target > 0;
  return { target, source, included };
}

describe('restoring from the origin marketplace', () => {
  it('uses the origin figure over the nine-day-old audit', () => {
    const p = planRow({ stored: 0, recovered: 2, mirrored: 5 }, true, true);
    expect(p).toMatchObject({ target: 5, source: 'origin marketplace', included: true });
  });

  it('falls back to the audit where the origin holds nothing', () => {
    // UK itself out of stock teaches us nothing new, so the audit stands in.
    expect(planRow({ stored: 0, recovered: 2, mirrored: 0 }, true, true))
      .toMatchObject({ target: 2, source: 'push audit', included: true });
  });

  it('leaves a listing we never emptied alone, however healthy the origin', () => {
    // The 390 already at zero and the 47 never ours. A sibling's stock is not permission to refill.
    expect(planRow({ stored: 0, recovered: 0, mirrored: 5 }, true, true).included).toBe(false);
  });

  it('still restores nothing when neither origin nor audit can speak', () => {
    expect(planRow({ stored: 0, recovered: 0, mirrored: 0 }, true, true))
      .toMatchObject({ target: 0, included: false });
  });

  it('behaves as before when mirroring is off', () => {
    expect(planRow({ stored: 0, recovered: 2, mirrored: 5 }, false, true))
      .toMatchObject({ target: 2, source: 'push audit' });
  });

  it('prefers the origin even over a figure we still hold', () => {
    // A stale non-zero of our own is still the 20th's; the origin is today's.
    expect(planRow({ stored: 3, recovered: 2, mirrored: 5 }, true, false).target).toBe(5);
  });
});

/**
 * A restore has to be repeatable.
 *
 * A deploy took the US run at 80 of 116, and repeating it rewrote all 116 — nothing checked whether
 * a listing already held the figure being sent. Every one of those is a marketplace call that
 * changes nothing, and across the seven markets a second pass would have been roughly 900 of them.
 *
 * Skipping what already agrees makes a re-run resumable rather than merely harmless.
 */
const needsWriting = (listed: number, target: number) => target > 0 && listed !== target;

describe('re-running a restore', () => {
  it('writes a listing that is still at zero', () => {
    expect(needsWriting(0, 5)).toBe(true);
  });

  it('skips one already restored to the same figure', () => {
    expect(needsWriting(5, 5)).toBe(false);
  });

  it('writes one holding a different figure', () => {
    // Sold down since, or restored to a stale value — either way the target is what should stand.
    expect(needsWriting(3, 5)).toBe(true);
  });

  it('never writes when there is no figure to send', () => {
    // The rule the whole incident turned on: no target means leave it alone, never push zero.
    expect(needsWriting(0, 0)).toBe(false);
    expect(needsWriting(4, 0)).toBe(false);
  });

  it('leaves nothing to do on a completed run', () => {
    const listings = [[0, 5], [0, 2], [0, 1]] as const;
    const afterFirstPass = listings.map(([, t]) => [t, t] as const);
    expect(afterFirstPass.filter(([l, t]) => needsWriting(l, t))).toHaveLength(0);
  });

  it('leaves only the remainder after an interrupted run', () => {
    // 80 of 116 done: the second pass is the 36 that were missed.
    const done = Array.from({ length: 80 }, () => [5, 5] as const);
    const missed = Array.from({ length: 36 }, () => [0, 5] as const);
    expect([...done, ...missed].filter(([l, t]) => needsWriting(l, t))).toHaveLength(36);
  });
});
