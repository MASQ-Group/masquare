/**
 * Products whose SKUs differ only by punctuation — the same thing entered twice, or not.
 *
 *   REPORT=duplicate-skus bash scripts/prod-scan.sh
 *
 * These ten pairs are why the SKU matcher cannot simply stop caring about punctuation: widen it and
 * a listing would have two products to attach to. Whether that is a real ambiguity or a catalogue
 * that says the same thing twice is not a question code should answer, so this lays out what hangs
 * off each side — stock, availability, live listings, what has actually SOLD — and leaves it.
 *
 * The side with sales and listings is the one in use. A side with neither was probably typed once
 * and forgotten. Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const { buildSkuOwnerIndex, normaliseSku } = require('./.compiled/sku-match.cjs');

const squash = (s) => normaliseSku(s).replace(/[^a-z0-9]/g, '');

(async () => {
  const p = new PrismaClient();
  const products = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const index = buildSkuOwnerIndex(products);

  const bySquashed = new Map();
  for (const [k, owner] of index) {
    const q = squash(k);
    if (!q) continue;
    const seen = bySquashed.get(q) ?? [];
    if (!seen.some((o) => o.productId === owner.productId)) seen.push(owner);
    bySquashed.set(q, seen);
  }
  const pairs = [...bySquashed.entries()].filter(([, o]) => o.length > 1);
  const ids = [...new Set(pairs.flatMap(([, o]) => o.map((x) => x.productId)))];

  const [full, stock, avail, listings, sales] = await Promise.all([
    p.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, mainSku: true, title: true, createdAt: true,
        brand: { select: { name: true } }, vendor: { select: { name: true } },
        aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
    }),
    p.stockLevel.groupBy({ by: ['productId'], where: { productId: { in: ids } }, _sum: { quantityOnHand: true } }),
    p.productAvailability.findMany({ where: { productId: { in: ids } }, select: { productId: true, quantity: true } }),
    p.channelListing.groupBy({ by: ['productId'], where: { productId: { in: ids } }, _count: { _all: true } }),
    p.salesTransactionItem.groupBy({
      by: ['productId'], where: { productId: { in: ids }, deletedAt: null },
      _count: { _all: true }, _sum: { quantity: true },
    }),
  ]);
  const m = (rows, f) => new Map(rows.map((r) => [r.productId, f(r)]));
  const byId = new Map(full.map((f) => [f.id, f]));
  const stockBy = m(stock, (r) => r._sum.quantityOnHand ?? 0);
  const availBy = m(avail, (r) => r.quantity);
  const listBy = m(listings, (r) => r._count._all);
  const salesBy = m(sales, (r) => ({ orders: r._count._all, units: Number(r._sum.quantity ?? 0) }));

  console.log(`\n  ${pairs.length} pair(s) that differ only by punctuation\n`);
  for (const [q, owners] of pairs) {
    console.log(`  ── "${q}" ──`);
    for (const o of owners) {
      const f = byId.get(o.productId);
      const s = salesBy.get(o.productId);
      console.log(`     ${String(f?.mainSku ?? o.sku).padEnd(36)} ${f?.title ?? ''}`);
      console.log(`       created ${f?.createdAt?.toISOString().slice(0, 10)}`
        + `   brand ${f?.brand?.name ?? '—'}   vendor ${f?.vendor?.name ?? '—'}`);
      console.log(`       stock ${String(stockBy.get(o.productId) ?? 0).padStart(4)}`
        + `   availability ${String(availBy.get(o.productId) ?? '—').padStart(4)}`
        + `   listings ${String(listBy.get(o.productId) ?? 0).padStart(3)}`
        + `   sold ${String(s?.units ?? 0).padStart(4)} unit(s) over ${s?.orders ?? 0} line(s)`
        + (f?.aliases.length ? `   aliases ${f.aliases.map((a) => a.skuValue).join(', ')}` : ''));
    }
    const used = owners.filter((o) => (salesBy.get(o.productId)?.orders ?? 0) > 0 || (listBy.get(o.productId) ?? 0) > 0);
    console.log(`     -> ${used.length === 1 ? `only ${byId.get(used[0].productId)?.mainSku} is in use`
      : used.length === 0 ? 'NEITHER has sold or is listed — both may be dead'
      : 'BOTH are in use — not a safe merge without a decision'}\n`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
