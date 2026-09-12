/** Listing plans and attempts for one SKU, and whether the SKU exists anywhere we have pulled. */
const { PrismaClient } = require('@prisma/client');
const SKU = process.env.SKU || '90-ELIT200BL';
(async () => {
  const p = new PrismaClient();
  const prod = await p.product.findFirst({ where: { deletedAt: null, mainSku: SKU }, select: { id: true, mainSku: true, title: true } });
  console.log(`  product ${SKU}  ${prod ? prod.id : 'NOT FOUND'}\n`);

  const plans = await p.productChannelPlan.findMany({
    where: { productId: prod.id },
    select: { integrationId: true, marketplace: true, status: true, channelSku: true, listedAt: true, updatedAt: true, offerPriceCents: true },
  });
  const ints = new Map((await p.channelIntegration.findMany({ select: { id: true, name: true, marketplace: true } })).map((i) => [i.id, i]));
  console.log(`  ${plans.length} channel plan(s):`);
  for (const pl of plans) {
    const i = ints.get(pl.integrationId);
    console.log(`    ${String(i?.name ?? pl.integrationId).padEnd(16)} status=${String(pl.status).padEnd(12)} channelSku=${pl.channelSku ?? '—'}`
      + `  listedAt=${pl.listedAt?.toISOString().slice(0, 16) ?? '—'}  updated=${pl.updatedAt.toISOString().slice(0, 16)}`);
  }

  // Anything in the account carrying this SKU, or looking like it.
  const like = await p.channelListing.findMany({
    where: { channelSku: { contains: SKU.slice(0, 9), mode: 'insensitive' } },
    select: { channelSku: true, productId: true, listedQuantity: true, listingStatus: true,
      integration: { select: { name: true } } },
  });
  console.log(`\n  listing rows whose SKU starts "${SKU.slice(0, 9)}": ${like.length}`);
  for (const l of like.slice(0, 12)) {
    console.log(`    ${l.channelSku.padEnd(20)} ${String(l.integration.name).padEnd(16)} qty=${l.listedQuantity ?? '—'} status=${l.listingStatus ?? '—'} matched=${l.productId ? 'yes' : 'NO'}`);
  }

  const be = await p.channelIntegration.findFirst({ where: { deletedAt: null, marketplace: 'BE' }, select: { id: true, name: true, status: true } });
  console.log(`\n  Amazon BE integration: ${be ? `${be.name} [${be.status}]` : 'NONE'}`);
  const beListings = be ? await p.channelListing.count({ where: { integrationId: be.id } }) : 0;
  console.log(`  listings pulled from BE so far: ${beListings}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
