/**
 * Whether one SKU can be put live, marketplace by marketplace, and what is in its way.
 *
 *   SKU=IT68278 REPORT=sku-live-readiness bash scripts/prod-scan.sh
 *
 * Asks ops/automation-state.ts itself, compiled fresh by the runner, so this report and the Live
 * switch cannot disagree. SKU is data for a `where` clause, never part of a command; the report
 * itself stays on the runner's fixed allowlist. Reads only — nothing is switched on here.
 */
const { PrismaClient } = require('@prisma/client');
// The real rule, compiled from source on every run rather than restated here: a report that
// re-implements the check it is reporting on is a second opinion from the same author.
const { planStateChange } = require('./.compiled/automation-state.cjs');
const { MARKETPLACE_TO_ISO } = require('./.compiled/repricing.config.cjs');
// The writer does not consider every Amazon integration — only full-scope ones (an orders-only
// company's account is unreachable from repricing). Counting without this rule invents a conflict.
const { fullScopeIntegrationWhere } = require('./.compiled/amazon-scope.cjs');
const { resolvePriceRange } = require('./.compiled/price-range.cjs');

const SKU = (process.env.SKU || '').trim();
const money = (c, ccy) => (c == null ? '—' : `${(c / 100).toFixed(2)} ${ccy}`);
const when = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : 'never');

/** How far a single submission may move a price before the safety layer refuses it. */
const MAX_STEP_PCT = 0.15;

(async () => {
  const p = new PrismaClient();

  const control = await p.repricingControl.findFirst();
  console.log('PLATFORM SWITCHES');
  console.log(`  live writes      ${control?.liveWritesEnabled ? 'ON — live SKUs send prices to Amazon' : 'off — live SKUs evaluate but send nothing'}`);
  console.log(`  kill switch      ${control?.killSwitchEngaged ? 'ENGAGED — nothing is sent at all' : 'clear'}`);

  // With no SKU named, review the pilot itself: exactly which listings can now write, and what
  // the first write would be.
  if (!SKU) {
    await reviewLivePilot(p, control);
    await p.$disconnect();
    return;
  }

  const rows = await p.repricingSkuPricing.findMany({
    where: { sku: SKU, deletedAt: null },
    include: { preset: { select: { name: true } } },
    orderBy: { marketplaceId: 'asc' },
  });
  if (rows.length === 0) {
    console.log(`\nNo repricing row for ${SKU}. It has not been onboarded — run Onboard SKUs for its marketplace.`);
    await p.$disconnect();
    return;
  }

  // Every Amazon listing we hold for this SKU, whether or not repricing knows about it. The
  // repricing table is filled by onboarding, so a channel can be selling perfectly well and simply
  // never have been onboarded — which reads exactly like "not listed" if you only look there.
  const listings = await p.channelListing.findMany({
    where: { channelSku: SKU, integration: { channelType: 'amazon', deletedAt: null } },
    include: { integration: { select: { name: true, marketplace: true } } },
    orderBy: { marketplace: 'asc' },
  });
  console.log(`\nAMAZON LISTINGS FOR ${SKU}: ${listings.length}`);
  for (const l of listings) {
    const code = (l.marketplace || l.integration.marketplace || '?').toUpperCase();
    console.log(`  ${code.padEnd(4)} ${String(l.asin ?? '—').padEnd(12)} ${String(l.listingStatus ?? '—').padEnd(9)} qty ${String(l.listedQuantity ?? '—').padStart(4)}  ${l.listedPrice ?? '—'} ${l.currency ?? ''}  ${l.productId ? 'matched' : 'UNMATCHED to catalogue'}  pulled ${when(l.lastPulledAt)}`);
  }

  const now = new Date();
  console.log(`\n${SKU} — ${rows.length} repricing row(s)`);
  for (const r of rows) {
    const stale = r.floorStaleAfter != null && r.floorStaleAfter.getTime() <= now.getTime();
    console.log(`\n  ${r.marketplaceId}  ASIN ${r.asin ?? '—'}  ${r.fulfillment}  state ${r.automationState}${r.suppressed ? '  SUPPRESSED' : ''}`);
    console.log(`    strategy        ${r.strategy}${r.preset ? ` (${r.preset.name})` : ''}`);
    console.log(`    breakeven       ${money(r.breakevenCents, r.currency)}`);
    console.log(`    margin floor    ${money(r.strategyFloorCents, r.currency)}`);
    console.log(`    min / max       ${money(r.minPriceCents, r.currency)} / ${money(r.maxPriceCents, r.currency)}`);
    console.log(`    current price   ${money(r.currentPriceCents, r.currency)}`);
    console.log(`    floors computed ${when(r.floorsComputedAt)}   stale after ${when(r.floorStaleAfter)}${stale ? '  ← STALE' : ''}`);
    console.log(`    exclusion       ${r.exclusionReason ?? 'none'}`);

    // The same call the Live switch makes, so this report and the button cannot disagree.
    const plan = planStateChange(
      { automationState: r.automationState, exclusionReason: r.exclusionReason, breakevenCents: r.breakevenCents, strategyFloorCents: r.strategyFloorCents, floorStaleAfter: r.floorStaleAfter, strategy: r.strategy },
      'LIVE',
      { now, liveWritesEnabled: !!control?.liveWritesEnabled },
    );
    console.log(`    CAN GO LIVE?    ${plan.ok ? 'YES' : 'no'}`);
    for (const problem of plan.problems) console.log(`      · ${problem}`);
    for (const note of plan.notes) console.log(`      note: ${note}`);

    const [decisions, recent, samples] = await Promise.all([
      p.repricingDecision.count({ where: { sku: r.sku, marketplaceId: r.marketplaceId } }),
      p.repricingDecision.findMany({
        where: { sku: r.sku, marketplaceId: r.marketplaceId },
        orderBy: { at: 'desc' },
        take: 5,
        select: { at: true, outcome: true, branch: true, reason: true, beforePriceCents: true, rawTargetCents: true, finalPriceCents: true, buyBoxLandedCents: true },
      }),
      p.repricingMarketSample.count({ where: { sku: r.sku, marketplaceId: r.marketplaceId } }),
    ]);
    console.log(`    evaluated       ${decisions} decision(s), ${samples} market sample(s)`);
    // What shadow has been deciding is the best available answer to "what happens if I switch this
    // on" — the same evaluation, with the send suppressed.
    for (const d of recent) {
      console.log(`      ${when(d.at)}  ${String(d.outcome).padEnd(9)} ${String(d.branch ?? '—').padEnd(10)} ${money(d.beforePriceCents, r.currency)} → ${money(d.finalPriceCents ?? d.rawTargetCents, r.currency)}  buybox ${money(d.buyBoxLandedCents, r.currency)}  ${d.reason ?? ''}`);
    }
  }

  // Turning live writes on is a platform switch, not a SKU switch: it releases every LIVE SKU at
  // once. Anyone piloting one SKU needs to know who else is holding the door.
  // Which marketplaces have been onboarded at all. A listing on a marketplace with no repricing
  // rows is not a problem with the SKU — nothing there has been onboarded yet.
  const coverage = await p.repricingSkuPricing.groupBy({ by: ['marketplaceId'], where: { deletedAt: null }, _count: { _all: true } });
  console.log('\nREPRICING COVERAGE (SKUs onboarded per marketplace)');
  for (const g of coverage.sort((a, b) => b._count._all - a._count._all)) console.log(`  ${g.marketplaceId}  ${g._count._all}`);

  const live = await p.repricingSkuPricing.groupBy({ by: ['marketplaceId'], where: { automationState: 'LIVE', deletedAt: null }, _count: { _all: true } });
  const liveTotal = live.reduce((n, g) => n + g._count._all, 0);
  console.log(`
SKUs ALREADY LIVE ACROSS THE ESTATE: ${liveTotal}`);
  for (const g of live) console.log(`  ${g.marketplaceId}  ${g._count._all}`);
  if (liveTotal === 0) console.log('  none — switching live writes on would release only what you put live now');

  await p.$disconnect();
})();

/**
 * The pilot, reviewed: every listing that can now write a price, and what its first write would be.
 *
 * Answers the question actually being asked after switching the toggle on — "is this exactly what I
 * meant, and nothing else?" — so it names what is live, what is not, and the things that would stop
 * a live SKU from pricing anyway.
 */
async function reviewLivePilot(p, control) {
  const live = await p.repricingSkuPricing.findMany({
    where: { automationState: 'LIVE', deletedAt: null },
    include: { preset: { select: { name: true } } },
    orderBy: [{ marketplaceId: 'asc' }, { sku: 'asc' }],
  });
  console.log(`\nLIVE LISTINGS: ${live.length}`);
  if (live.length === 0) {
    console.log('  none — nothing can write a price, whatever the toggle says');
    return;
  }

  const now = new Date();
  for (const r of live) {
    const stale = r.floorStaleAfter != null && r.floorStaleAfter.getTime() <= now.getTime();
    const hoursLeft = r.floorStaleAfter ? Math.round((r.floorStaleAfter.getTime() - now.getTime()) / 3600000) : null;
    console.log(`\n  ${r.sku}  ${r.marketplaceId}  ASIN ${r.asin ?? '—'}  ${r.fulfillment}  ${r.strategy}${r.preset ? ` (${r.preset.name})` : ''}`);
    console.log(`    breakeven ${money(r.breakevenCents, r.currency)}   floor ${money(r.strategyFloorCents, r.currency)}   min ${money(r.minPriceCents, r.currency)}   max ${money(r.maxPriceCents, r.currency)}`);
    console.log(`    price now ${money(r.currentPriceCents, r.currency)}   amazon band ${money(r.amazonMinAllowedCents, r.currency)} – ${money(r.amazonMaxAllowedCents, r.currency)}`);
    console.log(`    floors    ${when(r.floorsComputedAt)} → stale ${when(r.floorStaleAfter)}${stale ? '  ← STALE, it will be auto-excluded' : hoursLeft != null ? `  (${hoursLeft}h left)` : ''}`);

    /**
     * The floor the engine will actually clamp to — clearance, else a minimum price, else the
     * margin floor — from the engine's own resolver. Reading `strategyFloorCents` directly would
     * report the margin floor on a SKU whose minimum price has replaced it, and invent a problem.
     */
    const range = resolvePriceRange({
      breakevenCents: r.breakevenCents,
      marginFloorCents: r.strategyFloorCents,
      minPriceCents: r.minPriceCents,
      maxPriceCents: r.maxPriceCents,
      clearance: r.clearanceFloorCents != null ? { floorCents: r.clearanceFloorCents, reason: r.clearanceReason, endsAt: r.clearanceEndsAt, untilStock: r.clearanceUntilStock } : null,
      availableUnits: null,
      now,
    });
    const SOURCE = { clearance: 'clearance floor', min_price: 'minimum price', margin: 'margin floor' };
    console.log(`    prices between ${money(range.floorCents, r.currency)} (${SOURCE[range.floorSource]}) and ${money(range.maxPriceCents, r.currency)}; never under ${money(range.lowestAllowedCents, r.currency)}`);

    const flags = [];
    if (r.exclusionReason) flags.push(`exclusion: ${r.exclusionReason}`);
    if (stale) flags.push('floors stale — the hourly sweep will drop it to EXCLUDED');
    if (r.strategy === 'MANUAL_ONLY') flags.push('strategy is Manual only: it will never send a price');
    if (r.maxPriceCents == null) flags.push('no maximum price set — only the fair-pricing ceiling caps an upward move');
    if (r.suppressed) flags.push('suppressed');
    for (const n of range.notes) flags.push(n);
    // A margin floor overridden by a lower minimum is a deliberate choice, but it is the choice to
    // earn less than the strategy asks for, and it should be visible rather than implied.
    if (range.floorSource === 'min_price' && r.strategyFloorCents != null && range.floorCents != null && range.floorCents < r.strategyFloorCents) {
      const overBreakeven = r.breakevenCents ? ((range.floorCents - r.breakevenCents) / r.breakevenCents) * 100 : null;
      flags.push(`the minimum price ${money(range.floorCents, r.currency)} undercuts the margin floor ${money(r.strategyFloorCents, r.currency)}` +
        (overBreakeven != null ? `, leaving ${overBreakeven.toFixed(1)}% over breakeven at the bottom of the range` : ''));
    }
    if (r.currentPriceCents != null && range.floorCents != null && r.currentPriceCents < range.floorCents) {
      const stepPct = ((range.floorCents - r.currentPriceCents) / r.currentPriceCents) * 100;
      flags.push(
        `price is BELOW the floor in use: a first priced decision lifts it to at least ${money(range.floorCents, r.currency)} (+${stepPct.toFixed(1)}%)` +
        (stepPct / 100 > MAX_STEP_PCT ? ` — over the ${MAX_STEP_PCT * 100}% step limit, so the safety layer would VETO it` : ''),
      );
    }
    if (r.currentPriceCents != null && range.maxPriceCents != null && r.currentPriceCents > range.maxPriceCents) {
      flags.push(`price is ABOVE its maximum ${money(range.maxPriceCents, r.currency)} — a priced decision brings it down`);
    }
    console.log(flags.length ? flags.map((f) => `    ! ${f}`).join('\n') : '    nothing in the way');

    const [count, last] = await Promise.all([
      p.repricingDecision.count({ where: { sku: r.sku, marketplaceId: r.marketplaceId } }),
      p.repricingDecision.findFirst({ where: { sku: r.sku, marketplaceId: r.marketplaceId }, orderBy: { at: 'desc' }, select: { at: true, outcome: true, branch: true, reason: true, submissionStatus: true } }),
    ]);
    console.log(`    decisions ${count}; last ${last ? `${last.outcome}${last.submissionStatus ? `/${last.submissionStatus}` : ''} (${last.branch}) ${when(last.at)} — ${last.reason ?? ''}` : 'never evaluated'}`);

    // Whether anything has actually been SENT yet, which is the only proof the pilot works
    // end to end. A decision carries a submission status only once the writer has handled it.
    const [written, submitted] = await Promise.all([
      p.channelPriceHistory.count({ where: { channelSku: r.sku, marketplaceId: r.marketplaceId, source: 'repricer' } }),
      p.repricingDecision.findFirst({
        where: { sku: r.sku, marketplaceId: r.marketplaceId, submissionStatus: { not: null } },
        orderBy: { at: 'desc' },
        select: { at: true, submissionStatus: true, finalPriceCents: true },
      }),
    ]);
    console.log(`    sent      ${written} price(s) written by the repricer; last submission ${submitted ? `${submitted.submissionStatus} ${money(submitted.finalPriceCents, r.currency)} at ${when(submitted.at)}` : 'none yet'}`);

    /**
     * What has happened SINCE it went live, which is the only window that can say anything about
     * the pilot. `updatedAt` moves when the state is switched — and also on other row writes, so it
     * is the earliest this could have been live, not a precise moment. A decision in this window
     * with no submission status is the thing to explain: the writer was not reached.
     */
    const sinceLive = await p.repricingDecision.findMany({
      where: { sku: r.sku, marketplaceId: r.marketplaceId, at: { gte: r.updatedAt } },
      orderBy: { at: 'asc' },
      select: { at: true, outcome: true, submissionStatus: true, finalPriceCents: true, reason: true },
    });
    console.log(`    since it was last switched (${when(r.updatedAt)}): ${sinceLive.length} decision(s)`);
    for (const d of sinceLive.slice(-5)) {
      console.log(`      ${when(d.at)}  ${String(d.outcome).padEnd(9)} submission ${String(d.submissionStatus ?? 'not reached').padEnd(10)} ${money(d.finalPriceCents, r.currency)}  ${d.reason ?? ''}`);
    }
  }

  /**
   * The channel each write goes out through. The writer resolves the marketplace to ONE Amazon
   * integration and refuses if two match, because a price sent to the wrong seller account cannot
   * be undone by noticing later — so the count is the thing to check, not just that one exists.
   */
  const markets = [...new Set(live.map((r) => r.marketplaceId))];
  const scope = await fullScopeIntegrationWhere(p);
  const ints = await p.channelIntegration.findMany({ where: { channelType: 'amazon', deletedAt: null, ...scope }, select: { id: true, name: true, marketplace: true } });
  const allInts = await p.channelIntegration.findMany({ where: { channelType: 'amazon', deletedAt: null }, select: { name: true, marketplace: true, targetCompanyId: true } });
  console.log('\nCHANNELS THESE WRITE THROUGH');
  for (const m of markets) {
    const iso = MARKETPLACE_TO_ISO[m] ?? '?';
    const forMarket = ints.filter((i) => (i.marketplace || '').toUpperCase() === iso);
    const verdict = forMarket.length === 1 ? `→ ${forMarket[0].name}`
      : forMarket.length === 0 ? 'NO Amazon integration for this marketplace — every write would error'
        : `${forMarket.length} integrations match — the writer REFUSES to price this marketplace`;
    console.log(`  ${iso} (${m})  ${verdict}`);
    const outOfScope = allInts.filter((i) => (i.marketplace || '').toUpperCase() === iso).length - forMarket.length;
    if (outOfScope > 0) console.log(`      (${outOfScope} other ${iso} integration(s) exist but are orders-only or unassigned, so repricing cannot reach them)`);
  }

  // Anything else that could write today.
  const others = await p.repricingSkuPricing.groupBy({ by: ['automationState'], where: { deletedAt: null }, _count: { _all: true } });
  console.log('\nEVERY OTHER SKU (none of these can write a price)');
  for (const g of others.sort((a, b) => b._count._all - a._count._all)) console.log(`  ${String(g.automationState).padEnd(12)} ${g._count._all}`);
}
