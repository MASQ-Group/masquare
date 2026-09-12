/**
 * Did the fourteen punctuation SKUs land on the product they should have?
 *
 *   REPORT=punctuation-outcome bash scripts/prod-scan.sh
 *
 * A relink reporting `claimed: 0` after the rows were already claimed looks identical to one that
 * did nothing at all. The counts cannot tell those apart; the rows can. Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const { buildLooseSkuIndex, buildSkuOwnerIndex, matchSku } = require('./.compiled/sku-match.cjs');

const SKUS = [
  'BE-BF600 WHITE', 'BE-FC 65', 'BE-WL32', 'IT-55879', 'BE-KS19 BREAKFAST', '92- GC6815/20',
  'LAG- 7.2003.12G', 'LAG- 5.2033.19', '47- AS126E', 'BE-BF600 BLACK', 'BE-MP 58',
  'BE-BF600BLACK', 'BE-BF600 Black', 'BE-KS19-FRESH',
];

(async () => {
  const p = new PrismaClient();
  const products = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const index = buildSkuOwnerIndex(products);
  const loose = buildLooseSkuIndex(products);
  const nameById = new Map(products.map((x) => [x.id, x.mainSku]));

  let right = 0, wrong = 0, unlinked = 0, rowsTotal = 0;
  console.log('');
  for (const sku of SKUS) {
    const rows = await p.channelListing.findMany({
      where: { channelSku: { equals: sku, mode: 'insensitive' } },
      select: { productId: true, listedQuantity: true },
    });
    const expected = matchSku(sku, index, loose).owner;
    const linked = rows.filter((r) => r.productId);
    const onExpected = rows.filter((r) => r.productId && r.productId === expected?.productId);
    rowsTotal += rows.length;
    right += onExpected.length;
    wrong += linked.length - onExpected.length;
    unlinked += rows.length - linked.length;
    const qty = rows.reduce((s, r) => s + (r.listedQuantity ?? 0), 0);
    const verdict = rows.length === 0 ? 'no rows'
      : onExpected.length === rows.length ? 'all on the right product'
      : linked.length === 0 ? 'STILL UNLINKED'
      : `${onExpected.length}/${rows.length} right`;
    console.log(`    ${sku.padEnd(22)} ${String(rows.length).padStart(3)} row(s), qty ${String(qty).padStart(3)}`
      + `  -> ${String(expected ? expected.sku : '—').padEnd(22)} ${verdict}`
      + (linked.length && !onExpected.length ? `  (on ${nameById.get(linked[0].productId) ?? '?'})` : ''));
  }
  console.log(`\n    ${rowsTotal} row(s): ${right} on the expected product, ${wrong} elsewhere, ${unlinked} still unlinked\n`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
