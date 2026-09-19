/**
 * Every channel listing row the platform holds for one product, by SKU — what the listing cards read.
 *
 *   SKU=LE-83306 REPORT=product-listings bash scripts/prod-scan.sh
 *
 * Read-only. Written when eBay and OnBuy cards showed no "Edit price": a card offers it only for a
 * listing the channel sync has pulled, so this says which rows exist and when each was last pulled.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const sku = (process.env.SKU || '').trim();
  if (!sku) { console.log('Set SKU=… to name the product.'); return; }
  const p = new PrismaClient();
  const product = await p.product.findFirst({ where: { mainSku: sku, deletedAt: null }, select: { id: true, mainSku: true } });
  if (!product) { console.log(`No product with SKU ${sku}.`); await p.$disconnect(); return; }
  const rows = await p.channelListing.findMany({
    where: { productId: product.id },
    select: {
      channelSku: true, marketplace: true, listedPrice: true, currency: true, listedQuantity: true, externalListingId: true, lastPulledAt: true,
      integration: { select: { name: true, channelType: true } },
    },
    orderBy: [{ integrationId: 'asc' }, { marketplace: 'asc' }],
  });
  console.log(`${product.mainSku}: ${rows.length} channel listing rows`);
  for (const r of rows) {
    console.log(`  ${String(r.integration.channelType).padEnd(6)} ${String(r.integration.name).padEnd(22)} market=${JSON.stringify(r.marketplace)} sku=${r.channelSku} price=${r.listedPrice ?? '—'} ${r.currency ?? ''} qty=${r.listedQuantity ?? '—'} item=${r.externalListingId ?? '—'} pulled=${r.lastPulledAt?.toISOString() ?? 'never'}`);
  }
  const plans = await p.productChannelPlan.findMany({
    where: { productId: product.id, deletedAt: null, status: { in: ['LISTED', 'SUBMITTED'] } },
    select: { status: true, marketplace: true, channelSku: true, externalListingId: true, listedAt: true, integration: { select: { name: true, channelType: true } } },
  });
  console.log(`\nPlans recorded as listed or submitted: ${plans.length}`);
  for (const pl of plans) {
    console.log(`  ${String(pl.integration.channelType).padEnd(6)} ${String(pl.integration.name).padEnd(22)} ${pl.status} market=${JSON.stringify(pl.marketplace)} sku=${pl.channelSku ?? '—'} id=${pl.externalListingId ?? '—'} at=${pl.listedAt?.toISOString() ?? '—'}`);
  }
  await p.$disconnect();
})();
