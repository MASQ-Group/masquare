/**
 * Everything the platform holds about one SKU's channel listings, and the channels behind them.
 *
 *   SKU=IT68277 REPORT=sku-listing-trace bash scripts/prod-scan.sh
 *
 * Built because a SKU showed 19 units live on Amazon UK's own screen and an empty quantity on ours.
 * The interesting part is rarely the listing row itself — it is which integration owns it, which
 * sales channel that integration points at, and whether the page is reading a different one.
 *
 * Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const SKU = process.env.SKU || 'IT68277';

(async () => {
  const p = new PrismaClient();

  const prod = await p.product.findFirst({
    where: { deletedAt: null, mainSku: SKU },
    select: { id: true, mainSku: true, title: true },
  });
  console.log(`  product ${SKU}: ${prod ? prod.id : 'NOT FOUND'}  ${(prod?.title ?? '').slice(0, 50)}\n`);

  const listings = await p.channelListing.findMany({
    where: { OR: [{ channelSku: SKU }, ...(prod ? [{ productId: prod.id }] : [])] },
    select: {
      channelSku: true, marketplace: true, listedQuantity: true, listedPrice: true, currency: true,
      listingStatus: true, fulfilmentChannel: true, productId: true, asin: true, lastPulledAt: true,
      integration: {
        select: {
          name: true, status: true, deletedAt: true, marketplace: true,
          targetSalesChannelId: true, lastSyncedAt: true,
        },
      },
    },
  });

  const chanIds = [...new Set(listings.map((l) => l.integration.targetSalesChannelId).filter(Boolean))];
  const chans = new Map((await p.salesChannel.findMany({
    where: { id: { in: chanIds } },
    select: { id: true, name: true, deletedAt: true },
  })).map((c) => [c.id, c]));

  console.log(`  ${listings.length} listing row(s) for this SKU / product:`);
  for (const l of listings.sort((a, b) => String(a.integration.name).localeCompare(String(b.integration.name)))) {
    const i = l.integration;
    const c = i.targetSalesChannelId ? chans.get(i.targetSalesChannelId) : null;
    console.log(`    ${String(i.name).padEnd(14)} qty=${String(l.listedQuantity ?? '—').padStart(5)}`
      + `  price=${String(l.listedPrice ?? '—').padStart(8)} ${l.currency ?? ''}`
      + `  status=${String(l.listingStatus ?? '—').padEnd(10)} ${l.fulfilmentChannel ?? '—'}`);
    console.log(`      sku=${l.channelSku}  matched=${l.productId ? 'yes' : 'NO'}  asin=${l.asin ?? '—'}`
      + `  pulled=${l.lastPulledAt ? l.lastPulledAt.toISOString().slice(0, 16) : 'never'}`);
    console.log(`      integration status=${i.status} deleted=${!!i.deletedAt} mkt=${i.marketplace ?? '—'}`
      + `  -> channel "${c?.name ?? 'NONE'}"${c?.deletedAt ? ' (DELETED)' : ''} ${i.targetSalesChannelId ?? ''}`);
  }

  console.log('\n  every sales channel with "UK" in the name:');
  const ukChans = await p.salesChannel.findMany({
    where: { name: { contains: 'UK' } },
    select: { id: true, name: true, deletedAt: true, company: { select: { officialName: true } } },
  });
  for (const c of ukChans) {
    const ints = await p.channelIntegration.findMany({
      where: { targetSalesChannelId: c.id, deletedAt: null },
      select: { name: true, status: true },
    });
    const lc = await p.channelListing.count({ where: { integration: { targetSalesChannelId: c.id } } });
    const tx = await p.salesTransaction.count({ where: { deletedAt: null, salesChannelId: c.id } });
    console.log(`    ${c.name.padEnd(12)} ${c.id}  deleted=${!!c.deletedAt}  company=${c.company?.officialName ?? '—'}`);
    console.log(`      integrations: ${ints.map((i) => `${i.name}[${i.status}]`).join(', ') || 'NONE'}`
      + `   listings: ${lc}   orders: ${tx}`);
  }

  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
