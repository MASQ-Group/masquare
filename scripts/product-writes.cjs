/**
 * When a product was last written, and what the history says wrote it — for a save refused as stale.
 *
 *   SKU=LE-83306 REPORT=product-writes bash scripts/prod-scan.sh
 *
 * Read-only. The product card refuses a save when the product's updatedAt is newer than the one it
 * loaded; this shows that timestamp beside the product's recent history and the channel activity
 * around it, to find which write moved it.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const sku = (process.env.SKU || '').trim();
  if (!sku) { console.log('Set SKU=… to name the product.'); return; }
  const p = new PrismaClient();
  const product = await p.product.findFirst({
    where: { mainSku: sku, deletedAt: null },
    select: { id: true, mainSku: true, updatedAt: true, updatedById: true, createdAt: true },
  });
  if (!product) { console.log(`No product with SKU ${sku}.`); await p.$disconnect(); return; }
  console.log(`${product.mainSku}: updatedAt=${product.updatedAt.toISOString()} updatedBy=${product.updatedById ?? '—'}`);

  const activity = await p.activity.findMany({
    where: { entityId: product.id },
    select: { createdAt: true, action: true, source: true, summary: true, changes: true },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });
  console.log(`\nHistory (latest ${activity.length})`);
  for (const a of activity) {
    const fields = a.changes && typeof a.changes === 'object' ? Object.keys(a.changes).slice(0, 8).join(',') : '';
    console.log(`  ${a.createdAt.toISOString()} ${a.action} source=${a.source} ${a.summary ?? ''} ${fields ? `[${fields}]` : ''}`);
  }

  const since = new Date(product.updatedAt.getTime() - 10 * 60 * 1000);
  const until = new Date(product.updatedAt.getTime() + 10 * 60 * 1000);
  const [media, plans, avail] = await Promise.all([
    p.productMedia.findMany({ where: { productId: product.id, updatedAt: { gte: since, lte: until } }, select: { updatedAt: true, deletedAt: true } }),
    p.productChannelPlan.findMany({ where: { productId: product.id, updatedAt: { gte: since, lte: until } }, select: { updatedAt: true, status: true, integration: { select: { name: true } } } }),
    p.productAvailability.findFirst({ where: { productId: product.id }, select: { updatedAt: true, lastSource: true, quantity: true } }),
  ]);
  console.log(`\nAround that time (±10 min): ${media.length} image changes, ${plans.length} plan changes`);
  for (const pl of plans) console.log(`  plan ${pl.integration.name} ${pl.status} at ${pl.updatedAt.toISOString()}`);
  for (const m of media) console.log(`  image ${m.deletedAt ? 'removed' : 'changed'} at ${m.updatedAt.toISOString()}`);
  if (avail) console.log(`  availability qty=${avail.quantity} (${avail.lastSource ?? '—'}) at ${avail.updatedAt.toISOString()}`);
  await p.$disconnect();
})();
