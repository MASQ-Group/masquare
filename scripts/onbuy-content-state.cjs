/**
 * What a product's OnBuy content holds: the words on the product, the OnBuy plan's category, mode,
 * researched fields and safety text, and the recent history that wrote them.
 *
 *   SKU=LAG-612676 REPORT=onbuy-content-state bash scripts/prod-scan.sh
 *
 * Read-only. Written when Claude's OnBuy content did not appear on the OnBuy content tab.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const sku = (process.env.SKU || '').trim();
  if (!sku) { console.log('Set SKU=… to name the product.'); return; }
  const p = new PrismaClient();
  const product = await p.product.findFirst({
    where: { mainSku: sku, deletedAt: null },
    select: {
      id: true, mainSku: true, updatedAt: true,
      onbuyTitle: true, onbuyDescriptionHtml: true, onbuySummaryPoints: true, onbuyAiModel: true,
      ebayTitle: true, descriptionHtml: true, keyFeatures: true,
    },
  });
  if (!product) { console.log(`No product with SKU ${sku}.`); await p.$disconnect(); return; }
  const len = (v) => (v == null ? 'null' : `${String(v).length} chars`);
  console.log(`${product.mainSku} updatedAt=${product.updatedAt.toISOString()}`);
  console.log(`  OnBuy: title=${len(product.onbuyTitle)} description=${len(product.onbuyDescriptionHtml)} points=${product.onbuySummaryPoints.length} aiModel=${product.onbuyAiModel ?? 'null'}`);
  console.log(`  eBay:  title=${len(product.ebayTitle)} description=${len(product.descriptionHtml)} features=${product.keyFeatures.length}`);

  const plans = await p.productChannelPlan.findMany({
    where: { productId: product.id, deletedAt: null, integration: { channelType: 'onbuy' } },
    select: { id: true, marketplace: true, status: true, categoryRef: true, categoryName: true, aspects: true, specifics: true, safetyContent: true, updatedAt: true },
  });
  console.log(`\nOnBuy plans: ${plans.length}`);
  for (const pl of plans) {
    const a = pl.aspects && typeof pl.aspects === 'object' ? pl.aspects : {};
    const spec = pl.specifics && typeof pl.specifics === 'object' ? Object.keys(pl.specifics) : [];
    const safety = pl.safetyContent && typeof pl.safetyContent === 'object' ? Object.entries(pl.safetyContent).filter(([, v]) => v).map(([k]) => k) : [];
    console.log(`  market=${JSON.stringify(pl.marketplace)} status=${pl.status} category=${pl.categoryRef ?? '—'} (${pl.categoryName ?? '—'}) mode=${a.onbuyMode ?? '—'} opc=${a.opc ?? '—'}`);
    console.log(`  specifics: ${spec.length ? spec.join(', ') : 'none'} | safety: ${safety.length ? safety.join(', ') : 'none'} | updated ${pl.updatedAt.toISOString()}`);
  }

  const activity = await p.activity.findMany({
    where: { entityId: product.id },
    select: { createdAt: true, action: true, source: true, summary: true, changes: true },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  console.log(`\nHistory (latest ${activity.length})`);
  for (const a of activity) {
    const fields = Array.isArray(a.changes) ? a.changes.map((c) => c && c.field).filter(Boolean).join(',') : '';
    console.log(`  ${a.createdAt.toISOString()} ${a.action} source=${a.source} ${a.summary ?? ''} ${fields ? `[${fields}]` : ''}`);
  }
  await p.$disconnect();
})();
