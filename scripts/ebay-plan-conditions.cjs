/**
 * Has any eBay listing gone out as NEW when somebody chose otherwise?
 *
 *   REPORT=ebay-plan-conditions bash scripts/prod-scan.sh
 *
 * The product's channel drawer offered eBay conditions New, Open box and Used. The publish only
 * understands NEW, USED_EXCELLENT and USED_GOOD, and reads anything else as "not set" — which then
 * defaults to NEW. So choosing Used or Open box there published the item as New, silently. Selling
 * used goods as new is against eBay's rules and a return waiting to happen.
 *
 * Read-only. Lists every eBay plan whose stored condition the publish would not have understood,
 * and whether it has been listed.
 */
const { PrismaClient } = require('@prisma/client');

const UNDERSTOOD = new Set(['NEW', 'USED_EXCELLENT', 'USED_GOOD']);

(async () => {
  const p = new PrismaClient();

  const ebay = await p.channelIntegration.findMany({ where: { channelType: 'ebay' }, select: { id: true } });
  const plans = await p.productChannelPlan.findMany({
    where: { integrationId: { in: ebay.map((i) => i.id) }, deletedAt: null },
    select: { condition: true, status: true, externalListingId: true, product: { select: { mainSku: true } } },
  });

  const counts = {};
  for (const pl of plans) counts[pl.condition] = (counts[pl.condition] ?? 0) + 1;
  console.log('  eBay plans by stored condition:');
  for (const [c, n] of Object.entries(counts)) {
    console.log(`    ${String(c).padEnd(16)} ${String(n).padStart(4)}   ${UNDERSTOOD.has(String(c).toUpperCase()) ? '' : '<- publish reads this as NEW'}`);
  }

  const misread = plans.filter((pl) => !UNDERSTOOD.has(String(pl.condition).toUpperCase()));
  const live = misread.filter((pl) => pl.status === 'LISTED' || pl.externalListingId);
  console.log('');
  console.log(`  plans whose condition would publish as NEW   ${misread.length}`);
  console.log(`    already listed                             ${live.length}   <- on sale as New`);
  for (const pl of misread.slice(0, 20)) {
    console.log(`      ${String(pl.product?.mainSku).padEnd(22)} chose ${String(pl.condition).padEnd(10)} ${pl.externalListingId ? `item ${pl.externalListingId}` : 'not listed'}`);
  }

  await p.$disconnect();
})();
