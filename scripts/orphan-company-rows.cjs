/** Do the rows the relink never examined have a null companyId? Reads only. */
const { PrismaClient } = require('@prisma/client');
const { buildLooseSkuIndex, buildSkuOwnerIndex, matchSku } = require('./.compiled/sku-match.cjs');
(async () => {
  const p = new PrismaClient();
  const products = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const index = buildSkuOwnerIndex(products);
  const loose = buildLooseSkuIndex(products);

  const rows = await p.channelListing.findMany({
    where: { productId: null },
    select: { channelSku: true, companyId: true, integration: { select: { name: true } } },
  });
  const withCo = rows.filter((r) => r.companyId != null);
  const noCo = rows.filter((r) => r.companyId == null);
  console.log(`\n  unlinked rows: ${rows.length}   with a companyId: ${withCo.length}   with NULL: ${noCo.length}`);

  const claimable = (list) => list.filter((r) => matchSku(r.channelSku, index, loose).how === 'punctuation');
  console.log(`\n  of the ${withCo.length} with a company, punctuation-claimable: ${claimable(withCo).length}`);
  console.log(`  of the ${noCo.length} with NULL,       punctuation-claimable: ${claimable(noCo).length}`);

  const byInt = new Map();
  for (const r of noCo) byInt.set(r.integration?.name ?? '—', (byInt.get(r.integration?.name ?? '—') ?? 0) + 1);
  console.log(`\n  the NULL-company rows by integration\n`);
  for (const [k, n] of [...byInt.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(24)} ${n}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
