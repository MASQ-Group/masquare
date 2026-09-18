/**
 * Which eBay listings the platform published lead with the wrong image?
 *
 *   REPORT=ebay-featured-image bash scripts/prod-scan.sh
 *
 * eBay makes a listing's first image its main one. The platform sent images in upload order while the
 * product page — "first is featured" — orders by sortOrder. So wherever the featured image was chosen
 * after upload, a published listing led with a different picture. Only listings the platform itself
 * published are affected: hand-made ones had their images set on eBay directly.
 *
 * Read-only. Lists the products whose two orders disagree, so those listings can be updated.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  const ebay = await p.channelIntegration.findMany({ where: { channelType: 'ebay' }, select: { id: true } });
  const plans = await p.productChannelPlan.findMany({
    where: { integrationId: { in: ebay.map((i) => i.id) }, deletedAt: null },
    select: {
      status: true, externalListingId: true,
      product: {
        select: {
          mainSku: true,
          media: { where: { deletedAt: null }, select: { id: true, url: true, sortOrder: true, createdAt: true } },
        },
      },
    },
  });

  let differ = 0; let listedDiffer = 0;
  const rows = [];
  for (const pl of plans) {
    const media = pl.product?.media ?? [];
    if (media.length < 2) continue;
    const byUpload = [...media].sort((a, b) => a.createdAt - b.createdAt)[0];
    const featured = [...media].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)[0];
    if (byUpload.id === featured.id) continue;
    differ += 1;
    const listed = pl.status === 'LISTED' || !!pl.externalListingId;
    if (listed) listedDiffer += 1;
    rows.push(`    ${String(pl.product.mainSku).padEnd(22)} ${listed ? `LISTED item ${pl.externalListingId ?? '—'}` : 'not listed yet'}`);
  }

  console.log(`  eBay plans                                   ${plans.length}`);
  console.log(`  whose featured image is not the first upload ${differ}`);
  console.log(`    of those already published by the platform ${listedDiffer}   <- leading with the wrong image now`);
  for (const r of rows) console.log(r);
  await p.$disconnect();
})();
