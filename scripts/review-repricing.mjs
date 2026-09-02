// Where the Amazon repricer stands, read-only.
//
// It has been running in shadow mode — computing what it WOULD do without submitting anything.
// The point of that period is to answer one question before live writes are ever enabled: does it
// decide sensibly, and would any of those decisions have been embarrassing?
//
// So this reports what it has been doing, and then the things worth being uneasy about: prices
// pinned to the floor, quarantined SKUs, decisions the safety layer stopped, and whether the
// notification pipeline is still actually feeding it.
//
// Writes nothing. Reads nothing sensitive.
//
// Usage:
//   node scripts/review-repricing.mjs          # last 7 days
//   node scripts/review-repricing.mjs 14       # last 14 days

import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { announceDatabase } from './db-target.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
announceDatabase(ROOT);

const DAYS = Number(process.argv[2] || 7);
const prisma = new PrismaClient();
const since = new Date(Date.now() - DAYS * 86400_000);
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—');
const eur = (c) => (c == null ? '—' : `${(c / 100).toFixed(2)}`);

async function main() {
  console.log(`Window: last ${DAYS} days (since ${since.toISOString().slice(0, 10)})\n`);

  // --- Is it armed? ---------------------------------------------------------
  const control = await prisma.repricingControl.findFirst();
  console.log('='.repeat(64));
  console.log('SAFETY');
  console.log('='.repeat(64));
  console.log(`  Live writes:  ${control?.liveWritesEnabled ? '** ENABLED — it is submitting prices **' : 'off (shadow mode)'}`);
  console.log(`  Kill switch:  ${control?.killSwitchEngaged ? 'ENGAGED' : 'not engaged'}`);
  console.log(`  Last changed: ${control?.updatedAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '—'}`);

  // --- Is anything still arriving? -----------------------------------------
  const [latest, recent, total] = await Promise.all([
    prisma.repricingDecision.findFirst({ orderBy: { at: 'desc' }, select: { at: true } }),
    prisma.repricingDecision.count({ where: { at: { gte: since } } }),
    prisma.repricingDecision.count(),
  ]);
  const ageMin = latest ? Math.round((Date.now() - latest.at.getTime()) / 60000) : null;
  console.log('');
  console.log('='.repeat(64));
  console.log('IS IT STILL RUNNING?');
  console.log('='.repeat(64));
  console.log(`  Last decision: ${latest ? `${latest.at.toISOString().slice(0, 16).replace('T', ' ')} (${ageMin} min ago)` : 'never'}`);
  console.log(`  Decisions in window: ${recent.toLocaleString()}   (all time ${total.toLocaleString()})`);
  if (ageMin != null && ageMin > 180) {
    // The repricer is driven by Amazon's ANY_OFFER_CHANGED notifications. Silence means the
    // subscription or the queue has stopped, not that the market went quiet.
    console.log('  ** Nothing for over 3 hours — the notification pipeline has probably stopped. **');
  }

  // --- What did it decide? --------------------------------------------------
  const byOutcome = await prisma.repricingDecision.groupBy({
    by: ['outcome'], where: { at: { gte: since } }, _count: true,
  });
  const n = (o) => byOutcome.find((x) => x.outcome === o)?._count ?? 0;
  console.log('');
  console.log('='.repeat(64));
  console.log('WHAT IT DECIDED');
  console.log('='.repeat(64));
  for (const o of byOutcome.sort((a, b) => b._count - a._count)) {
    console.log(`  ${o.outcome.padEnd(12)} ${String(o._count).padStart(7)}  ${pct(o._count, recent)}`);
  }
  console.log('');
  console.log('  PRICED = it would have submitted a new price. HELD = the price was already right.');
  console.log('  SKIPPED = not actionable (no competitor, not the buy box, no change).');
  console.log('  QUARANTINED = refused to price it at all — see below.');

  // --- The uncomfortable part ----------------------------------------------
  const priced = await prisma.repricingDecision.findMany({
    where: { at: { gte: since }, outcome: 'PRICED' },
    select: { sku: true, marketplaceId: true, at: true, beforePriceCents: true, finalPriceCents: true, rawTargetCents: true, clamps: true, strategy: true },
    orderBy: { at: 'desc' },
  });

  // `clamps` lists every clamp the engine EVALUATED, each with `bound` saying whether it actually
  // bit. Matching the clamp's name alone reports 100% every time, because the floor is always
  // considered — only `bound: true` means the price was held up by it.
  //
  // A price pinned to the floor is the repricer saying "I would have gone lower if allowed". A few
  // is the system working. A large share means either the floors are wrong or the competition is
  // selling below our cost, and the honest answer there is not to compete.
  const boundBy = (d, name) => (Array.isArray(d.clamps) ? d.clamps : []).some((c) => c?.clamp === name && c?.bound === true);
  const atFloor = priced.filter((d) => boundBy(d, 'STRATEGY_FLOOR'));
  const atCeiling = priced.filter((d) => boundBy(d, 'FAIR_PRICING_CEILING'));

  const drops = priced.filter((d) => d.beforePriceCents != null && d.finalPriceCents != null && d.finalPriceCents < d.beforePriceCents);
  const rises = priced.filter((d) => d.beforePriceCents != null && d.finalPriceCents != null && d.finalPriceCents > d.beforePriceCents);
  // One SKU reconsidered forty times is one story, not forty — keep its worst and move on.
  const worstBySku = new Map();
  for (const d of drops) {
    const delta = (d.beforePriceCents - d.finalPriceCents) / d.beforePriceCents;
    const key = `${d.sku}:${d.marketplaceId}`;
    if (!worstBySku.has(key) || worstBySku.get(key).delta < delta) worstBySku.set(key, { ...d, delta });
  }
  const biggestDrop = [...worstBySku.values()].sort((a, b) => b.delta - a.delta).slice(0, 6);

  console.log('');
  console.log('='.repeat(64));
  console.log('WOULD ANY OF IT HAVE EMBARRASSED US?');
  console.log('='.repeat(64));
  console.log(`  Price cuts:   ${drops.length.toLocaleString()}   raises: ${rises.length.toLocaleString()}`);
  console.log(`  Held up by the floor:   ${atFloor.length.toLocaleString()}  ${pct(atFloor.length, priced.length)} of priced`);
  console.log(`  Held down by the ceiling: ${atCeiling.length.toLocaleString()}  ${pct(atCeiling.length, priced.length)} of priced`);
  if (biggestDrop.length) {
    console.log('\n  Largest cuts it wanted to make (worst per SKU):');
    for (const d of biggestDrop) {
      console.log(`    ${d.sku.slice(0, 26).padEnd(26)} ${d.marketplaceId.padEnd(14)} ${eur(d.beforePriceCents)} -> ${eur(d.finalPriceCents)}  (-${Math.round(d.delta * 100)}%)`);
    }
  }

  const quarantined = await prisma.repricingDecision.groupBy({
    by: ['sku'], where: { at: { gte: since }, outcome: 'QUARANTINED' }, _count: true,
  });
  if (quarantined.length) {
    console.log(`\n  Quarantined SKUs: ${quarantined.length}`);
    for (const q of quarantined.sort((a, b) => b._count - a._count).slice(0, 8)) {
      console.log(`    ${q.sku.slice(0, 34).padEnd(34)} ${q._count}x`);
    }
  }

  // --- Is the floor a wall, or a choice? ------------------------------------
  //
  // The single question the shadow period has to answer. Two floors exist per SKU: `breakeven`,
  // below which we lose money, and `strategyFloor`, which is breakeven plus the margin we have
  // decided to insist on. They are very different things wearing the same word.
  //
  // When a price is held at the strategy floor, either the market is below our COST — refusing is
  // correct and there is nothing to fix — or the market is between cost and our target margin, in
  // which case we are declining business we could profitably take, and that is a policy dial rather
  // than an economic wall.
  //
  // `rawTarget` is what the engine wanted before clamping, so comparing it to breakeven separates
  // the two directly.
  if (atFloor.length) {
    const keys = [...new Set(atFloor.map((d) => `${d.sku}|${d.marketplaceId}`))];
    const rows = await prisma.repricingSkuPricing.findMany({
      where: { OR: keys.map((k) => ({ sku: k.split('|')[0], marketplaceId: k.split('|')[1] })) },
      select: { sku: true, marketplaceId: true, breakevenCents: true, strategyFloorCents: true },
    });
    const byKey = new Map(rows.map((r) => [`${r.sku}|${r.marketplaceId}`, r]));

    let couldHaveTaken = 0;   // wanted price still above cost — a choice
    let genuinelyBelowCost = 0; // wanted price below cost — a wall
    let unknown = 0;
    let forgoneCents = 0;
    const examples = [];

    for (const d of atFloor) {
      const p = byKey.get(`${d.sku}|${d.marketplaceId}`);
      if (!p || p.breakevenCents == null || d.rawTargetCents == null) { unknown++; continue; }
      if (d.rawTargetCents >= p.breakevenCents) {
        couldHaveTaken++;
        forgoneCents += (d.finalPriceCents ?? 0) - d.rawTargetCents;
        examples.push({ sku: d.sku, mk: d.marketplaceId, want: d.rawTargetCents, floor: d.finalPriceCents, be: p.breakevenCents });
      } else {
        genuinelyBelowCost++;
      }
    }

    const known = couldHaveTaken + genuinelyBelowCost;
    console.log('');
    console.log('='.repeat(64));
    console.log('IS THE FLOOR A WALL, OR A CHOICE?');
    console.log('='.repeat(64));
    console.log(`  Of ${atFloor.length.toLocaleString()} prices held at the floor:`);
    console.log(`    market below our COST      ${String(genuinelyBelowCost).padStart(6)}  ${pct(genuinelyBelowCost, known)}   <- correct to refuse, nothing to fix`);
    console.log(`    above cost, below target   ${String(couldHaveTaken).padStart(6)}  ${pct(couldHaveTaken, known)}   <- a margin choice, not a wall`);
    if (unknown) console.log(`    (no breakeven on record)   ${String(unknown).padStart(6)}`);

    if (couldHaveTaken) {
      // Per decision rather than a total: the same SKU is reconsidered many times, so summing
      // across them would invent a revenue figure nobody could ever have earned.
      console.log(`\n  Where it is a choice, we hold on average ${(forgoneCents / couldHaveTaken / 100).toFixed(2)} above what it wanted.`);
      const seen = new Set();
      const uniq = examples.filter((e) => !seen.has(e.sku + e.mk) && seen.add(e.sku + e.mk)).slice(0, 6);
      console.log('  Examples (wanted -> held at, cost):');
      for (const e of uniq) {
        console.log(`    ${e.sku.slice(0, 26).padEnd(26)} ${e.mk.padEnd(14)} ${eur(e.want)} -> ${eur(e.floor)}   cost ${eur(e.be)}`);
      }
    }

    // --- What would a different floor actually buy? -------------------------
    //
    // Measured as the GAP above breakeven, (price - breakeven) / price — deliberately not called a
    // margin, because it is not the number the engine is configured with.
    //
    // The engine targets margin on NET (ex-VAT) revenue. The referral fee is a percentage of GROSS,
    // so it scales with price and the two measures diverge by a constant factor:
    //   gap = margin / (1 - referral x (1 + vat))
    // At a 15% referral and 19-20% VAT that is about 1.22, which is why a configured 12% margin
    // shows up here as a 15% gap. Calling this figure a margin would invite someone to compare it
    // against the preset values and conclude the settings were not being applied.
    const gapOf = (price, cost) => (price > 0 ? (price - cost) / price : 0);

    // Derive the current policy from the data rather than assuming it. If the strategy floor is not
    // a uniform margin, the whole "lower the floor by N points" framing is the wrong question and
    // the spread below will say so.
    const policy = rows
      .filter((r) => r.breakevenCents != null && r.strategyFloorCents != null && r.strategyFloorCents > 0)
      .map((r) => gapOf(r.strategyFloorCents, r.breakevenCents))
      .sort((a, b) => a - b);
    if (policy.length) {
      const at = (q) => policy[Math.min(policy.length - 1, Math.floor(q * policy.length))];
      const spread = at(0.9) - at(0.1);
      console.log('');
      console.log('='.repeat(64));
      console.log('WHAT A DIFFERENT FLOOR WOULD BUY');
      console.log('='.repeat(64));
      console.log(`  Floors sit ${(at(0.5) * 100).toFixed(1)}% above breakeven (spread ${(spread * 100).toFixed(1)} points across the catalogue).`);
      console.log(`  That is the configured margin grossed up by the referral fee — a 12% target reads as ~15% here.`);
      if (spread > 0.02) {
        console.log('  ** Not a uniform rule — the table below is an approximation, and per-SKU floors');
        console.log('     would need looking at individually. **');
      }
    }

    // Each floor-bound decision the engine wanted at a price above cost is one it would have taken
    // had the floor been lower. Count decisions AND distinct SKUs: a decision count flatters the
    // opportunity, because one contested SKU is reconsidered dozens of times in a week.
    const candidates = [];
    for (const d of atFloor) {
      const p = byKey.get(`${d.sku}|${d.marketplaceId}`);
      if (!p || p.breakevenCents == null || d.rawTargetCents == null) continue;
      if (d.rawTargetCents < p.breakevenCents) continue; // below cost — no floor setting recovers it
      candidates.push({ key: `${d.sku}|${d.marketplaceId}`, gap: gapOf(d.rawTargetCents, p.breakevenCents) });
    }

    if (candidates.length) {
      console.log('');
      console.log('  If the floor sat at…     wins back        of which SKUs   at avg gap');
      // Gap thresholds, so they are comparable with the figure printed above.
      for (const floor of [0.12, 0.10, 0.08, 0.05, 0.0]) {
        const won = candidates.filter((c) => c.gap >= floor);
        const skus = new Set(won.map((c) => c.key)).size;
        const avg = won.length ? won.reduce((s, c) => s + c.gap, 0) / won.length : 0;
        const label = floor === 0 ? 'breakeven' : `${(floor * 100).toFixed(0)}%`;
        console.log(
          `    ${label.padStart(10)}          ${String(won.length).padStart(5)} decisions   ${String(skus).padStart(5)}        ${(avg * 100).toFixed(1)}%`,
        );
      }
      console.log('');
      console.log('  "Wins back" = decisions where the price it wanted clears that floor, so the sale');
      console.log('  would have been contested instead of conceded. It is an upper bound: winning the');
      console.log('  buy box also depends on rating, fulfilment and stock, none of which this sees.');
    }
  }

  // --- Coverage -------------------------------------------------------------
  const [onboarded, withFloor] = await Promise.all([
    prisma.repricingSkuPricing.count(),
    prisma.repricingSkuPricing.count({ where: { NOT: { strategyFloorCents: null } } }).catch(() => null),
  ]);
  const active = await prisma.repricingDecision.groupBy({ by: ['sku'], where: { at: { gte: since } }, _count: true });
  console.log('');
  console.log('='.repeat(64));
  console.log('COVERAGE');
  console.log('='.repeat(64));
  console.log(`  SKUs onboarded:        ${onboarded.toLocaleString()}`);
  if (withFloor != null) console.log(`  ...with a floor:       ${withFloor.toLocaleString()}  ${pct(withFloor, onboarded)}`);
  console.log(`  SKUs seen in window:   ${active.length.toLocaleString()}  ${pct(active.length, onboarded)} of onboarded`);
  console.log('\n  A low "seen" share is normal — Amazon only notifies on SKUs whose offers moved.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
