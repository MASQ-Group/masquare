/**
 * The OnBuy connections, and the OnBuy channel plans touched recently — which row holds the price,
 * the template and the status the listing screens read.
 *
 *   REPORT=onbuy-plan-state bash scripts/prod-scan.sh
 *
 * Read-only. Written when the price check reported "still needed: a price" with 35.00 on screen,
 * to see whether the price was saved to a different plan row than the one read back.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  const integrations = await p.channelIntegration.findMany({
    where: { channelType: 'onbuy', deletedAt: null },
    select: { id: true, name: true, marketplace: true, status: true, targetCompanyId: true, targetSalesChannelId: true },
  });
  console.log('OnBuy connections');
  for (const i of integrations) {
    console.log(`  ${i.id}  ${String(i.name).padEnd(24)} marketplace=${JSON.stringify(i.marketplace)} status=${i.status} company=${i.targetCompanyId ?? '—'} salesChannel=${i.targetSalesChannelId ?? '—'}`);
  }

  const since = new Date(Date.now() - 6 * 3600 * 1000);
  const plans = await p.productChannelPlan.findMany({
    where: { integrationId: { in: integrations.map((i) => i.id) }, updatedAt: { gte: since } },
    select: {
      id: true, productId: true, integrationId: true, marketplace: true, status: true, offerPriceCents: true,
      deliveryTemplate: true, handlingTimeDays: true, channelSku: true, aspects: true, deletedAt: true, updatedAt: true,
      product: { select: { mainSku: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  });
  console.log(`\nOnBuy plans updated in the last 6 hours: ${plans.length}`);
  for (const r of plans) {
    const a = r.aspects && typeof r.aspects === 'object' ? r.aspects : {};
    console.log(
      `  ${r.product?.mainSku ?? r.productId}  integration=${r.integrationId.slice(0, 8)} marketplace=${JSON.stringify(r.marketplace)}`
      + ` status=${r.status} price=${r.offerPriceCents ?? 'null'} template=${r.deliveryTemplate ?? 'null'} handling=${r.handlingTimeDays ?? 'null'}`
      + ` sku=${r.channelSku ?? 'null'} opc=${a.opc ?? '—'} mode=${a.onbuyMode ?? '—'} staged=${a.onbuyStaged ? 'yes' : 'no'}`
      + `${r.deletedAt ? ' DELETED' : ''} updated=${r.updatedAt.toISOString()}`,
    );
  }
  await p.$disconnect();
})();
