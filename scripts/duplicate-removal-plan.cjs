/**
 * Re-checks the duplicate cleanup against live data, immediately before anybody runs it.
 *
 *   REPORT=duplicate-removal-plan bash scripts/prod-scan.sh
 *
 * The decisions here were made by a person reading `duplicate-skus`, so they are written down rather
 * than re-derived: a rule general enough to pick these eight would also pick POT-CK920S599, which is
 * a DIFFERENT pair of sunglasses whose SKU happens to squash alike, and `Logistic Services`, which
 * has sold.
 *
 * What is NOT trusted is that the eight are still safe. Deleting a product here is a hard delete —
 * `products.service.remove` says so, and says why: it frees the SKU for re-use, which the LAG rename
 * depends on. So every one is re-checked for stock, availability, listings, sales and aliases at the
 * moment of asking, and anything that has grown an attachment since is refused rather than removed.
 *
 * Reads only. Prints what to run.
 */
const { PrismaClient } = require('@prisma/client');

/** mainSku -> why it goes. The survivor is named so the pairing can be checked by eye. */
const REMOVE = [
  ['Broom Head', 'Broom-Head'],
  ['Antibacterial Surface Cleaner 750ml', 'Antibacterial-Surface-Cleaner-750ml'],
  ['Microfibre Mop', 'Microfibre-Mop'],
  ['Mopping Bucket', 'Mopping-Bucket'],
  ['Broom / Mop Handle', 'Broom-Mop-Handle'],
  ['Sponge Cloth Large', 'Sponge-Cloth-Large'],
  ['OT-MR-101', 'OT-MR101'],
  /** The LAG pair inverts: the side holding the listings is the one with the stray space. */
  ['LAG-7.2003.15G', 'LAG- 7.2003.15G'],
];

const RENAME = { from: 'LAG- 7.2003.15G', to: 'LAG-7.2003.15G' };

(async () => {
  const p = new PrismaClient();
  const skus = [...REMOVE.flat(), RENAME.from, RENAME.to];
  const products = await p.product.findMany({
    where: { mainSku: { in: skus }, deletedAt: null },
    select: { id: true, mainSku: true, title: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const bySku = new Map(products.map((x) => [x.mainSku, x]));
  const ids = products.map((x) => x.id);

  const [stock, avail, listings, sales] = await Promise.all([
    p.stockLevel.groupBy({ by: ['productId'], where: { productId: { in: ids } }, _sum: { quantityOnHand: true } }),
    p.productAvailability.findMany({ where: { productId: { in: ids } }, select: { productId: true, quantity: true } }),
    p.channelListing.groupBy({ by: ['productId'], where: { productId: { in: ids } }, _count: { _all: true } }),
    p.salesTransactionItem.groupBy({ by: ['productId'], where: { productId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
  ]);
  const map = (rows, f) => new Map(rows.map((r) => [r.productId, f(r)]));
  const stockBy = map(stock, (r) => r._sum.quantityOnHand ?? 0);
  const availBy = map(avail, (r) => r.quantity);
  const listBy = map(listings, (r) => r._count._all);
  const salesBy = map(sales, (r) => r._count._all);

  const safe = [], refused = [];
  console.log(`\n  ${REMOVE.length} product(s) proposed for removal\n`);
  for (const [doomedSku, survivorSku] of REMOVE) {
    const d = bySku.get(doomedSku);
    const s = bySku.get(survivorSku);
    if (!d) { refused.push([doomedSku, 'no longer exists — already removed?']); continue; }
    if (!s) { refused.push([doomedSku, `survivor ${survivorSku} not found — do NOT remove`]); continue; }
    const attach = [
      ['stock', stockBy.get(d.id) ?? 0],
      ['availability', availBy.get(d.id) ?? 0],
      ['listings', listBy.get(d.id) ?? 0],
      ['sale lines', salesBy.get(d.id) ?? 0],
      ['aliases', d.aliases.length],
    ].filter(([, n]) => n !== 0);
    if (attach.length) {
      refused.push([doomedSku, `now has ${attach.map(([k, n]) => `${n} ${k}`).join(', ')}`]);
      continue;
    }
    safe.push(d);
    console.log(`    remove  ${doomedSku.padEnd(38)} ${d.id}`);
    console.log(`      keep  ${survivorSku.padEnd(38)} ${s.id}   (${listBy.get(s.id) ?? 0} listings, ${salesBy.get(s.id) ?? 0} sale lines)`);
  }

  if (refused.length) {
    console.log(`\n  REFUSED — something changed since the review\n`);
    for (const [sku, why] of refused) console.log(`    ${sku.padEnd(38)} ${why}`);
  }

  const from = bySku.get(RENAME.from);
  console.log(`\n  then rename\n`);
  if (!from) console.log(`    ${RENAME.from} not found`);
  else {
    console.log(`    ${from.id}`);
    console.log(`      mainSku  "${RENAME.from}"  ->  "${RENAME.to}"`);
    console.log(`      add alias "${RENAME.from}" so its ${listBy.get(from.id) ?? 0} listing(s) stay matchable by SKU`);
    console.log(`      (safe only once "${RENAME.to}" is removed above — mainSku is unique)`);
  }

  console.log(`\n  ── paste into the browser console on production, signed in ──\n`);
  console.log(`await (await fetch('/api/products/bulk/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('masquare.token') }, body: JSON.stringify({ ids: ${JSON.stringify(safe.map((x) => x.id))} }) })).json()`);
  console.log(`\n  ${safe.length} of ${REMOVE.length} safe to remove.\n`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
