/** How often one integration+marketplace holds more than one listing row for the same product. */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const rows = await p.channelListing.findMany({
    where: { productId: { not: null } },
    select: { productId: true, integrationId: true, marketplace: true, channelSku: true,
      listedQuantity: true, listingStatus: true, createdAt: true,
      integration: { select: { name: true, channelType: true } },
      product: { select: { mainSku: true } } },
  });
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.productId}|${r.integrationId}|${r.marketplace}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const dupes = [...byKey.values()].filter((v) => v.length > 1);
  // eBay legitimately spreads one integration over several marketplaces under marketplace ''.
  const amazonDupes = dupes.filter((v) => v[0].integration.channelType === 'amazon');
  console.log(`  product+integration+marketplace groups          ${byKey.size}`);
  console.log(`  groups holding MORE THAN ONE row               ${dupes.length}`);
  console.log(`  of those, on an Amazon integration             ${amazonDupes.length}\n`);
  const blanks = rows.filter((r) => r.listedQuantity == null && !String(r.listingStatus ?? '').trim());
  console.log(`  rows with no quantity and no status            ${blanks.length} of ${rows.length}`);
  console.log('\n  Amazon groups with a duplicate (up to 15):');
  for (const g of amazonDupes.slice(0, 15)) {
    console.log(`    ${String(g[0].product?.mainSku).padEnd(12)} ${g[0].integration.name}`);
    for (const r of g) {
      console.log(`       sku=${r.channelSku.padEnd(12)} qty=${String(r.listedQuantity ?? '—').padStart(4)}`
        + ` status=${(r.listingStatus || '—').padEnd(22)} created=${r.createdAt.toISOString().slice(0, 16)}`);
    }
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
