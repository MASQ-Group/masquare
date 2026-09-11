/** Where a listing row with an unexpected SKU came from: alias, plan, or the channel itself. */
const { PrismaClient } = require('@prisma/client');
const SKU = process.env.SKU || 'IT68277';
const ODD = process.env.ODD || 'IT-68277';
(async () => {
  const p = new PrismaClient();
  const prod = await p.product.findFirst({ where: { deletedAt: null, mainSku: SKU }, select: { id: true } });

  const aliases = await p.productSkuAlias.findMany({
    where: { productId: prod.id }, select: { skuValue: true, source: true, createdAt: true },
  }).catch(() => null);
  console.log('  aliases:', aliases ? JSON.stringify(aliases) : '(model not found)');

  const plans = await p.productChannelPlan.findMany({
    where: { productId: prod.id }, select: { chosenSku: true, state: true, updatedAt: true, integrationId: true },
  }).catch((e) => { console.log('  plans: ' + e.message.slice(0, 80)); return []; });
  for (const pl of plans) console.log(`  plan: chosenSku=${pl.chosenSku ?? '—'} state=${pl.state} ${pl.updatedAt?.toISOString().slice(0,16)}`);

  const rows = await p.channelListing.findMany({
    where: { channelSku: { in: [SKU, ODD] } },
    select: { channelSku: true, createdAt: true, updatedAt: true, lastPulledAt: true, lastPushedAt: true,
      title: true, listingStatus: true, integration: { select: { name: true } } },
  });
  console.log('\n  the two rows, with timestamps:');
  for (const r of rows) {
    console.log(`    ${r.channelSku.padEnd(10)} ${r.integration.name.padEnd(12)} created=${r.createdAt.toISOString().slice(0,16)}`
      + ` updated=${r.updatedAt.toISOString().slice(0,16)} pulled=${r.lastPulledAt?.toISOString().slice(0,16) ?? '—'}`
      + ` pushed=${r.lastPushedAt?.toISOString().slice(0,16) ?? '—'}`);
    console.log(`      title=${(r.title ?? '—').slice(0, 60)}  status=${r.listingStatus ?? '—'}`);
  }

  const orphans = await p.channelListing.count({ where: { listedQuantity: null, listingStatus: null } });
  const total = await p.channelListing.count();
  console.log(`\n  listing rows with no quantity AND no status: ${orphans} of ${total}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
