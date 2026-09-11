/** The aliases defined for a product, their fulfilment type, and whether each has a live listing. */
const { PrismaClient } = require('@prisma/client');
const SKU = process.env.SKU || 'IT68277';
(async () => {
  const p = new PrismaClient();
  const prod = await p.product.findFirst({ where: { deletedAt: null, mainSku: SKU }, select: { id: true, mainSku: true } });
  const aliases = await p.productSkuAlias.findMany({
    where: { productId: prod.id },
    select: { skuValue: true, label: true, deletedAt: true, createdAt: true,
      fulfilmentType: { select: { name: true, code: true } } },
  });
  console.log(`  aliases on ${prod.mainSku}:`);
  if (!aliases.length) console.log('    (none)');
  for (const a of aliases) {
    console.log(`    ${a.skuValue.padEnd(14)} label=${a.label ?? '—'}`
      + `  fulfilment=${a.fulfilmentType?.name ?? a.fulfilmentType?.code ?? '— NOT SET'}`
      + `  deleted=${!!a.deletedAt}  created=${a.createdAt.toISOString().slice(0, 16)}`);
  }
  const orphan = await p.productSkuAlias.findFirst({ where: { skuValue: 'IT-68277' }, select: { productId: true } });
  console.log(`\n  is "IT-68277" an alias anywhere? ${orphan ? 'yes, on product ' + orphan.productId : 'NO'}`);

  const totalAliases = await p.productSkuAlias.count({ where: { deletedAt: null } });
  const noFulfil = await p.productSkuAlias.count({ where: { deletedAt: null, fulfilmentTypeId: null } });
  console.log(`\n  aliases estate-wide ${totalAliases}, of which no fulfilment type set: ${noFulfil}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
