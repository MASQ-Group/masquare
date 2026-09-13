/** The products that already have an eBay category — what a gather would start from. Reads only. */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const plans = await p.productChannelPlan.findMany({
    where: { categoryRef: { not: null } },
    select: { productId: true, categoryRef: true, categoryName: true,
      integration: { select: { channelType: true } } },
  });
  const ebay = plans.filter((x) => x.integration?.channelType === 'ebay');
  for (const pl of ebay) {
    const pr = await p.product.findUnique({
      where: { id: pl.productId },
      select: { mainSku: true, title: true, ebayTitle: true, manufacturerSku: true, ean: true, upc: true,
        descriptionHtml: true, keyFeatures: true,
        brand: { select: { name: true } }, media: { where: { deletedAt: null }, select: { url: true } } },
    });
    console.log(`\n  ${pr.mainSku}  —  eBay category ${pl.categoryRef} "${pl.categoryName}"`);
    console.log(`    title            ${pr.title}`);
    console.log(`    brand            ${pr.brand?.name ?? '—'}`);
    console.log(`    manufacturerSku  ${pr.manufacturerSku ?? '—'}`);
    console.log(`    EAN / UPC        ${pr.ean ?? '—'} / ${pr.upc ?? '—'}`);
    console.log(`    images           ${pr.media.length}`);
    console.log(`    has description  ${pr.descriptionHtml ? 'yes' : 'no'}   key features ${pr.keyFeatures?.length ?? 0}`);
  }
  if (!ebay.length) console.log('  no eBay plans yet');
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
