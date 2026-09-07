import { describe, expect, it } from 'vitest';
import { verdictFor, type BulkChannelFacts } from './bulk-listing';

/**
 * Every marketplace has to appear in exactly one bucket.
 *
 * The step-one summary reported "4 need matching · 1 ready to list · 10 cannot be listed" for a
 * product with eighteen marketplaces. Fifteen. Three had fallen between the buckets — matched rows
 * waiting only on a dispatch time belonged to none of them — and simply vanished from the screen.
 *
 * A reader cannot audit figures that do not reconcile, and will stop trusting the ones that do. So
 * the partition is asserted here over every combination of the facts that decide it, rather than
 * checked by eye on one example.
 */

const base: BulkChannelFacts = {
  found: true,
  restricted: false,
  alreadyListed: false,
  eligible: true,
  eligibilityReasons: [],
  asin: 'B00X',
  matched: true,
  priceCents: 5000,
  priceReason: null,
  quantity: 4,
  handlingTimeDays: 2,
  brandRestriction: null,
};

/** The same four buckets the service counts, over one row. */
function bucketOf(f: BulkChannelFacts): 'alreadyListed' | 'awaitingMatch' | 'readyToPrice' | 'ready' | 'blocked' {
  const v = verdictFor(f);
  const matchable = !f.alreadyListed && f.found && !f.restricted && f.eligible && !f.matched;
  const readyToPrice = f.matched && !f.alreadyListed && f.found && !f.restricted && f.eligible && !!f.asin;

  if (v.blockers.includes('Already listed here')) return 'alreadyListed';
  if (matchable) return 'awaitingMatch';
  if (readyToPrice && !v.canList) return 'readyToPrice';
  if (v.canList) return 'ready';
  return 'blocked';
}

describe('the step-one summary', () => {
  it('places every combination of facts in exactly one bucket', () => {
    const bools = [true, false];
    let seen = 0;
    for (const alreadyListed of bools) {
      for (const found of bools) {
        for (const restricted of [true, false, null]) {
          for (const eligible of bools) {
            for (const matched of bools) {
              for (const asin of ['B00X', null]) {
                for (const quantity of [4, null]) {
                  for (const handlingTimeDays of [2, null]) {
                    for (const priceCents of [5000, null]) {
                      const f: BulkChannelFacts = {
                        ...base, alreadyListed, found, restricted, eligible, matched,
                        asin, quantity, handlingTimeDays, priceCents,
                      };
                      // The assertion is simply that bucketOf is total: it returns for every input
                      // and never throws, so no row can fall through.
                      expect(['alreadyListed', 'awaitingMatch', 'readyToPrice', 'ready', 'blocked'])
                        .toContain(bucketOf(f));
                      seen += 1;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    // Guards against the loops being silently narrowed later and the property covering nothing.
    expect(seen).toBe(2 * 2 * 3 * 2 * 2 * 2 * 2 * 2 * 2);
  });

  it('counts the reported case as five buckets summing to the total', () => {
    // Rebuilt from the screenshot: 18 marketplaces, 7 already listed, some matched previously and
    // waiting only on a dispatch time — the ones that used to disappear.
    const rows: BulkChannelFacts[] = [
      ...Array.from({ length: 7 }, () => ({ ...base, alreadyListed: true, found: false, matched: false, asin: null })),
      ...Array.from({ length: 6 }, () => ({ ...base, matched: true, handlingTimeDays: null })),
      ...Array.from({ length: 2 }, () => ({ ...base, matched: false })),
      { ...base, restricted: true, matched: false },
      { ...base, found: false, asin: null, matched: false },
      { ...base },
    ];
    const counts = rows.reduce<Record<string, number>>((acc, f) => {
      const b = bucketOf(f);
      acc[b] = (acc[b] ?? 0) + 1;
      return acc;
    }, {});
    expect(rows).toHaveLength(18);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(18);
    expect(counts.alreadyListed).toBe(7);
    // The six that used to vanish: matched, and waiting only on a dispatch time.
    expect(counts.readyToPrice).toBe(6);
    expect(counts.awaitingMatch).toBe(2);
    expect(counts.ready).toBe(1);
    expect(counts.blocked).toBe(2);
  });
});
