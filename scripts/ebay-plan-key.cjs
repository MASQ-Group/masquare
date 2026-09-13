/** What marketplace value eBay plans are keyed on, and what is actually stored. Reads only. */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const ints = await p.channelIntegration.findMany({
    where: { deletedAt: null, channelType: { in: ['ebay', 'onbuy'] } },
    select: { id: true, name: true, channelType: true, marketplace: true },
  });
  console.log(`\n  integrations — the value upsertPlan keys on\n`);
  for (const i of ints) console.log(`    ${i.channelType.padEnd(6)} ${i.name.padEnd(14)} marketplace = ${JSON.stringify(i.marketplace)}`);

  const plans = await p.productChannelPlan.findMany({
    where: { integrationId: { in: ints.map((i) => i.id) } },
    select: { productId: true, integrationId: true, marketplace: true, categoryRef: true, categoryName: true },
  });
  console.log(`\n  plans stored against those integrations: ${plans.length}\n`);
  const by = new Map();
  for (const pl of plans) {
    const k = `${ints.find((i) => i.id === pl.integrationId)?.name} / marketplace=${JSON.stringify(pl.marketplace)}`;
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  for (const [k, n] of by) console.log(`    ${k}  ->  ${n}`);
  for (const pl of plans.slice(0, 8)) {
    console.log(`      product ${pl.productId.slice(0, 8)}…  category ${pl.categoryRef ?? '—'}  "${pl.categoryName ?? ''}"`);
  }
  if (!plans.length) console.log(`    none yet`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
