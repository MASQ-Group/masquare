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
