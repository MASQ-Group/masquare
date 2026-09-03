// Which repricing strategy suits which brand.
//
// Assigning presets by brand is already supported; what was missing is the basis for deciding.
// This groups the shadow period's decisions by brand and reports the two things that actually
// discriminate between strategies:
//
//   - How often the floor stopped it. High means we are uncompetitive at our target margin, so
//     either the margin comes down for that brand or we accept not winning it.
//   - How often there was no competitor at all. High means the price is ours to choose, and
//     defending a floor is the wrong shape entirely — that is what Harvest is for.
//
// Read-only. Writes nothing, and assigns nothing: the recommendation is a starting point for a
// judgement, not a decision the data can make on its own.
//
// Usage: node scripts/repricing-by-brand.mjs [days]

import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { announceDatabase } from './db-target.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
announceDatabase(ROOT);

const DAYS = Number(process.argv[2] || 7);
const prisma = new PrismaClient();
const since = new Date(Date.now() - DAYS * 86400_000);
const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);

async function main() {
  // SKU -> brand, via the pricing row's product link.
  const pricing = await prisma.repricingSkuPricing.findMany({
    select: { sku: true, marketplaceId: true, productId: true, presetId: true, breakevenCents: true },
  });
  const productIds = [...new Set(pricing.map((p) => p.productId).filter(Boolean))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, brand: { select: { id: true, name: true } } },
  });
  const brandOf = new Map(products.map((p) => [p.id, p.brand]));

  const meta = new Map();
  for (const p of pricing) {
    const b = p.productId ? brandOf.get(p.productId) : null;
    meta.set(`${p.sku}|${p.marketplaceId}`, { brand: b?.name ?? '(no brand)', brandId: b?.id ?? null, presetId: p.presetId, breakeven: p.breakevenCents });
  }

  const decisions = await prisma.repricingDecision.findMany({
    where: { at: { gte: since } },
    select: { sku: true, marketplaceId: true, outcome: true, clamps: true, competitorSet: true, rawTargetCents: true },
  });

  const boundByFloor = (d) => (Array.isArray(d.clamps) ? d.clamps : []).some((c) => c?.clamp === 'STRATEGY_FLOOR' && c?.bound === true);
  /**
   * No QUALIFYING competitor — the price is ours to set rather than defend.
   *
   * `effective` is the set left after the engine drops offers it will not price against: our own
   * listing, non-domestic sellers, blocked sellers. `dropped` is usually non-empty even when
   * `effective` is empty, so counting "has a competitorSet" or "dropped.length" would find
   * competition on almost every decision and hide the thing worth seeing.
   */
  const uncontested = (d) => {
    const c = d.competitorSet;
    return !!c && Array.isArray(c.effective) && c.effective.length === 0;
  };

  const byBrand = new Map();
  for (const d of decisions) {
    const m = meta.get(`${d.sku}|${d.marketplaceId}`);
    if (!m) continue;
    const key = m.brand;
    if (!byBrand.has(key)) byBrand.set(key, { brand: key, brandId: m.brandId, skus: new Set(), decisions: 0, priced: 0, floor: 0, alone: 0, presets: new Set() });
    const b = byBrand.get(key);
    b.skus.add(d.sku);
    b.decisions++;
    if (m.presetId) b.presets.add(m.presetId);
    if (d.outcome === 'PRICED') {
      b.priced++;
      if (boundByFloor(d)) b.floor++;
    }
    if (uncontested(d)) b.alone++;
  }

  const rows = [...byBrand.values()].filter((b) => b.decisions >= 20).sort((a, b) => b.decisions - a.decisions);

  console.log(`Brands active in the last ${DAYS} days (20+ decisions), ${rows.length} of ${byBrand.size}\n`);
  console.log('  brand                    SKUs  decisions  priced  floor-bound  alone   suggests');
  console.log('  ' + '-'.repeat(88));

  for (const b of rows.slice(0, 30)) {
    const floorPct = pct(b.floor, b.priced);
    const alonePct = pct(b.alone, b.decisions);

    // A suggestion, not a verdict. Each rule states the observation it rests on, because a brand
    // is a commercial relationship and the numbers cannot see exclusivity, contracts or stock age.
    let suggests = '—';
    if (alonePct >= 60) suggests = 'Harvest (rarely contested)';
    else if (b.priced >= 10 && floorPct >= 80) suggests = 'Win Buy Box, or stop competing';
    else if (b.priced >= 10 && floorPct <= 20) suggests = 'Protect margin (floor rarely bites)';

    console.log(
      `  ${b.brand.slice(0, 22).padEnd(22)} ${String(b.skus.size).padStart(5)} ${String(b.decisions).padStart(10)} ${String(b.priced).padStart(7)} ` +
      `${String(floorPct + '%').padStart(11)} ${String(alonePct + '%').padStart(6)}   ${suggests}`,
    );
  }

  const assigned = rows.filter((b) => b.presets.size > 0).length;
  console.log(`\n  Presets currently assigned: ${assigned} of ${rows.length} brands.`);
  console.log('  "floor-bound" is of PRICED decisions; "alone" is of all decisions for that brand.');
  console.log('\n  These are prompts, not answers. A brand you hold exclusively should protect margin');
  console.log('  even when the floor bites, and a discontinued line should clear even when it does not.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
