/**
 * Exactly which listings the widened matcher would claim, using the shipped matcher.
 *
 *   REPORT=punctuation-claims bash scripts/prod-scan.sh
 *
 * A relink is a write, and the rule behind it just changed. Before anybody runs one, this says what
 * it would do to real rows: which SKUs get placed on a separator, which product each lands on, and
 * which stay unplaceable because two products claim them.
 *
 * Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const { buildLooseSkuIndex, buildSkuOwnerIndex, matchSku } = require('./.compiled/sku-match.cjs');
const { deriveListingStatus } = require('./.compiled/listing-status.cjs');

(async () => {
  const p = new PrismaClient();
  const products = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const index = buildSkuOwnerIndex(products);
  const loose = buildLooseSkuIndex(products);
  const ambiguous = [...loose.entries()].filter(([, v]) => v === null);
  console.log(`\n  ${index.size} exact SKUs, ${loose.size} punctuation-insensitive keys,`
    + ` ${ambiguous.length} of them claimed by more than one product`);
  for (const [k] of ambiguous) console.log(`      ambiguous: "${k}"`);

  const rows = await p.channelListing.findMany({
    where: { productId: null },
    select: {
      id: true, channelSku: true, listedQuantity: true, listingStatus: true, fulfilmentChannel: true,
      marketplace: true, integration: { select: { name: true } },
    },
  });

  const claims = new Map(), stuck = new Map();
  for (const r of rows) {
    const m = matchSku(r.channelSku, index, loose);
    if (m.how === 'punctuation') {
      const e = claims.get(r.channelSku) ?? { owner: m.owner, rows: [] };
      e.rows.push(r); claims.set(r.channelSku, e);
    } else if (m.how === 'ambiguous') {
      const e = stuck.get(r.channelSku) ?? { rows: [] };
      e.rows.push(r); stuck.set(r.channelSku, e);
    }
  }

  const rowCount = [...claims.values()].reduce((s, e) => s + e.rows.length, 0);
  console.log(`\n  would claim ${rowCount} row(s) across ${claims.size} SKU(s)\n`);
  for (const [sku, e] of [...claims.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length)) {
    const buyable = e.rows.filter((r) => deriveListingStatus(r) !== 'paused').length;
    const qty = e.rows.reduce((s, r) => s + (r.listedQuantity ?? 0), 0);
    console.log(`    ${String(sku).padEnd(26)} -> ${String(e.owner.sku).padEnd(26)}`
      + ` ${String(e.rows.length).padStart(3)} row(s), ${buyable} buyable, qty ${qty}`);
    console.log(`        ${[...new Set(e.rows.map((r) => `${r.integration?.name}${r.marketplace ? ' ' + r.marketplace : ''}`))].join(', ')}`);
  }

  console.log(`\n  would stay unplaceable — two products claim the SKU: ${stuck.size}\n`);
  for (const [sku, e] of stuck) console.log(`    ${String(sku).padEnd(26)} ${e.rows.length} row(s)`);
  if (!stuck.size) console.log(`    none`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
