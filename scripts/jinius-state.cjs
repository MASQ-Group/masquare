/**
 * What the platform holds for Jinius: the connection, the orders pulled, and the transactions that
 * report them.
 *
 *   REPORT=jinius-state bash scripts/prod-scan.sh
 *
 * Read-only. Written when Sales Transactions showed no Jinius sales and a sync reported nothing.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  const integrations = await p.channelIntegration.findMany({
    where: { channelType: 'jinius', deletedAt: null },
    select: {
      id: true, name: true, status: true, marketplace: true, lastSyncedAt: true,
      targetCompanyId: true, targetSalesChannelId: true, mappingVerifiedAt: true,
    },
  });
  console.log(`Jinius connections: ${integrations.length}`);
  for (const i of integrations) {
    const ch = i.targetSalesChannelId
      ? await p.salesChannel.findUnique({ where: { id: i.targetSalesChannelId }, select: { name: true, kind: true, nativeCurrency: true, nativeCountry: { select: { isoCode: true, vatRate: true } } } })
      : null;
    console.log(`  ${i.name} status=${i.status} market=${i.marketplace ?? '—'} lastSynced=${i.lastSyncedAt?.toISOString() ?? 'never'}`);
    console.log(`    company=${i.targetCompanyId ?? '—'} salesChannel=${ch ? `${ch.name} (${ch.kind}, ${ch.nativeCurrency}, ${ch.nativeCountry?.isoCode} VAT ${ch.nativeCountry?.vatRate ?? '—'}%)` : 'NOT LINKED'} mappingVerified=${i.mappingVerifiedAt ? 'yes' : 'no'}`);
  }

  const orders = await p.jiniusOrder.count({ where: { deletedAt: null } });
  const withTx = await p.jiniusOrder.count({ where: { deletedAt: null, salesTransactionId: { not: null } } });
  const linked = await p.jiniusOrder.count({ where: { deletedAt: null, linkedTransactionId: { not: null } } });
  console.log(`\nJinius orders: ${orders} (${withTx} with a sales transaction, ${linked} invoiced locally)`);

  const byState = await p.jiniusOrder.groupBy({ by: ['state'], where: { deletedAt: null }, _count: { _all: true } });
  for (const s of byState) console.log(`  ${s.state}: ${s._count._all}`);

  const recent = await p.jiniusOrder.findMany({
    where: { deletedAt: null },
    orderBy: { orderedAt: 'desc' },
    take: 5,
    select: { orderId: true, commercialId: true, orderedAt: true, state: true, priceTotal: true, totalCommission: true, salesTransactionId: true, lines: { select: { offerSku: true, productId: true } } },
  });
  console.log('\nNewest orders held');
  for (const o of recent) {
    const unmatched = o.lines.filter((l) => !l.productId).length;
    console.log(`  ${o.commercialId ?? o.orderId} ${o.orderedAt.toISOString().slice(0, 10)} ${o.state} €${o.priceTotal} fee €${o.totalCommission} tx=${o.salesTransactionId ? 'yes' : 'NO'} lines=${o.lines.length}${unmatched ? ` (${unmatched} matching no product)` : ''}`);
  }

  const txs = await p.salesTransaction.count({ where: { deletedAt: null, source: 'jinius' } });
  console.log(`\nSales transactions with source=jinius: ${txs}`);
  await p.$disconnect();
})();
