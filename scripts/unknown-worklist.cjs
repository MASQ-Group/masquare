/**
 * The unknown-SKU worklist as the endpoint now returns it, and a CSV beside it.
 *
 *   REPORT=unknown-worklist bash scripts/prod-scan.sh
 *
 * Writes `unknown-skus.csv` into the repo root so the pile can be triaged offline — which is what
 * a thousand of anything needs. Reads the database only.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { buildLooseSkuIndex, buildSkuOwnerIndex, matchSku, normaliseSku, suggestOwnerBySuffix } = require('./.compiled/sku-match.cjs');
const { deriveListingStatus } = require('./.compiled/listing-status.cjs');

const csv = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

(async () => {
  const p = new PrismaClient();
  const products = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const index = buildSkuOwnerIndex(products);
  const loose = buildLooseSkuIndex(products);

  const rows = (await p.channelListing.findMany({
    where: { productId: null },
    select: {
      channelSku: true, title: true, listedQuantity: true, listedPrice: true, currency: true,
      marketplace: true, lastPulledAt: true, listingStatus: true, fulfilmentChannel: true,
      integration: { select: { name: true } },
    },
  })).filter((r) => !matchSku(r.channelSku, index, loose).owner);

  const bySku = new Map();
  for (const r of rows) {
    const k = normaliseSku(r.channelSku);
    const e = bySku.get(k) ?? { channelSku: r.channelSku, title: null, quantity: 0, price: null, currency: null, channels: [], rows: 0, buyable: 0 };
    e.rows += 1;
    e.quantity += r.listedQuantity ?? 0;
    if (!e.title && r.title) e.title = r.title;
    if (e.price == null && r.listedPrice != null) { e.price = r.listedPrice; e.currency = r.currency; }
    const ch = r.marketplace ? `${r.integration.name} ${r.marketplace}` : r.integration.name;
    if (!e.channels.includes(ch)) e.channels.push(ch);
    if (deriveListingStatus(r) !== 'paused') e.buyable += 1;
    bySku.set(k, e);
  }

  const items = [...bySku.values()]
    .map((e) => ({ ...e, channels: e.channels.sort(), suggestion: suggestOwnerBySuffix(e.channelSku, index, loose) }))
    .sort((a, b) => b.buyable - a.buyable || b.quantity - a.quantity || b.channels.length - a.channels.length
      || a.channelSku.localeCompare(b.channelSku));

  const worth = items.filter((i) => i.buyable > 0 || i.quantity > 0);
  console.log(`\n  ${rows.length} row(s) -> ${items.length} distinct SKU(s)`);
  console.log(`    worth chasing (buyable or stocked)  ${worth.length}`);
  console.log(`    the catalogue may already have it   ${items.filter((i) => i.suggestion).length}`);
  console.log(`    dead everywhere, no stock           ${items.length - worth.length}`);

  console.log(`\n  worst first\n`);
  for (const i of items.slice(0, 20)) {
    console.log(`    ${String(i.channelSku).padEnd(26)} ${String(i.buyable).padStart(2)} buyable / ${String(i.rows).padStart(2)} rows`
      + `  qty ${String(i.quantity).padStart(4)}  ${i.price != null ? `${i.price} ${i.currency ?? ''}` : ''}`);
    console.log(`        ${(i.title ?? '(no title from the channel)').slice(0, 96)}`);
    if (i.suggestion) console.log(`        suggestion: ${i.suggestion.owner.sku}  (dropping "${i.suggestion.dropped}") — confirm before using`);
  }

  const out = 'unknown-skus.csv';
  fs.writeFileSync(out, [
    ['sku', 'title', 'buyable_rows', 'total_rows', 'quantity', 'price', 'currency', 'channels', 'suggested_product', 'suggestion_drops'].join(','),
    ...items.map((i) => [
      i.channelSku, i.title, i.buyable, i.rows, i.quantity, i.price ?? '', i.currency ?? '',
      i.channels.join(' | '), i.suggestion?.owner.sku ?? '', i.suggestion?.dropped ?? '',
    ].map(csv).join(',')),
  ].join('\n'), 'utf8');
  console.log(`\n  wrote ${out} — ${items.length} row(s)\n`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
