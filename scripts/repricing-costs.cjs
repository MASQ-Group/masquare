/**
 * Which loaded costs each marketplace includes, and the returns rates in use.
 *
 *   REPORT=repricing-costs bash scripts/prod-scan.sh
 *
 * Storage and advertising are only counted where a person has switched them on; returns have no
 * switch at all and are always counted, from measured history or the 2% default. Reads only.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  const costs = await p.repricingMarketplaceCosts.findMany({ orderBy: { marketplaceId: 'asc' } });
  console.log('MARKETPLACE COSTS');
  for (const c of costs) {
    console.log(`  ${c.marketplaceId}  storage ${c.storageApplies ? 'ON' : 'off'} (${c.defaultStoragePerUnitCents ?? '—'}c)  ads ${c.adsApply ? 'ON' : 'off'} (${c.defaultAdCostPerUnitCents ?? '—'}c)`);
  }
  if (costs.length === 0) console.log('  none configured — storage and ads are off everywhere');

  const rows = await p.repricingSkuPricing.groupBy({
    by: ['marketplaceId', 'returnsRateSource'],
    _count: { _all: true },
    _avg: { returnsRatePct: true },
  });
  console.log('\nRETURNS RATE IN USE (per marketplace and where it came from)');
  for (const r of rows.sort((a, b) => a.marketplaceId.localeCompare(b.marketplaceId))) {
    console.log(`  ${r.marketplaceId}  ${String(r.returnsRateSource ?? 'not set').padEnd(12)} ${String(r._count._all).padStart(5)} SKUs  avg ${r._avg.returnsRatePct == null ? '—' : Number(r._avg.returnsRatePct).toFixed(2) + '%'}`);
  }

  const withAds = await p.repricingSkuPricing.count({ where: { adCostPerUnitCents: { not: null } } });
  const withStorage = await p.repricingSkuPricing.count({ where: { storagePerUnitCents: { not: null } } });
  console.log(`\nSKUs carrying their own figure: ads ${withAds}, storage ${withStorage}`);
  await p.$disconnect();
})();
