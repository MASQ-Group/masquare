/**
 * Why one SKU's "available to sell" and its availability quantity disagree.
 *
 *   SKU=IT51879 REPORT=sku-stock-trace bash scripts/prod-scan.sh
 *
 * They are two different numbers from two different places, and the card shows both:
 *
 *   available to sell    summed from `stock_level`, over warehouses flagged active AND
 *                        include-in-inventory. Physical, per location.
 *   availability qty     `product_availability.quantity` — one maintained figure per product,
 *                        moved by sales, returns, imports and by hand.
 *
 * Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const SKU = process.env.SKU;
if (!SKU) { console.error('Set SKU.'); process.exit(1); }

(async () => {
  const p = new PrismaClient();
  const product = await p.product.findFirst({
    where: { deletedAt: null, OR: [{ mainSku: SKU }, { aliases: { some: { skuValue: SKU, deletedAt: null } } }] },
    include: {
      aliases: { where: { deletedAt: null }, select: { skuValue: true } },
      availability: true,
      stockLevels: { include: { warehouse: { select: { name: true, type: true, isActive: true, includeInInventory: true, deletedAt: true } } } },
    },
  });
  if (!product) { console.log(`  ${SKU} matches no product.`); await p.$disconnect(); return; }

  console.log(`\n  ${product.mainSku} — ${product.title}`);
  if (product.aliases.length) console.log(`    aliases        ${product.aliases.map((a) => a.skuValue).join(', ')}`);

  let sellable = 0, total = 0;
  console.log(`\n    stock_level rows`);
  if (!product.stockLevels.length) console.log(`      (none)`);
  for (const l of product.stockLevels) {
    const w = l.warehouse;
    const counts = w.isActive && w.includeInInventory && !w.deletedAt;
    total += l.quantityOnHand;
    if (counts) sellable += l.quantityOnHand;
    console.log(`      ${String(w.name).padEnd(28)} ${String(w.type ?? '—').padEnd(10)} on hand ${String(l.quantityOnHand).padStart(4)}`
      + `   active=${w.isActive} inInventory=${w.includeInInventory}${w.deletedAt ? ' DELETED' : ''}`
      + `   ${counts ? '→ counts' : '→ NOT counted'}`);
  }
  console.log(`\n    available to sell (card)   ${sellable}`);
  console.log(`    total on hand (card)       ${total}`);
  console.log(`    availability quantity      ${product.availability?.quantity ?? '— (no row)'}`
    + `   lastSource=${product.availability?.lastSource ?? '—'}`
    + `   updated=${product.availability?.updatedAt?.toISOString() ?? '—'}`);

  const ledger = await p.availabilityLedger.findMany({
    where: { productId: product.id }, orderBy: { createdAt: 'desc' }, take: 12,
  });
  console.log(`\n    availability ledger (latest ${ledger.length})`);
  if (!ledger.length) console.log(`      (none — the quantity has never been moved through the ledger)`);
  for (const e of ledger) {
    console.log(`      ${e.createdAt.toISOString().slice(0, 19)}  ${String(e.reason).padEnd(16)}`
      + ` delta ${String(e.delta).padStart(4)} -> ${String(e.newQuantity).padStart(4)}`
      + `  ${e.refType ?? ''} ${e.note ?? ''}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
