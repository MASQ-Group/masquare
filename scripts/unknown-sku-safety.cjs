/**
 * Could the catalogue match these SKUs more loosely WITHOUT matching the wrong product?
 *
 *   REPORT=unknown-sku-safety bash scripts/prod-scan.sh
 *
 * Two questions, both of which have to be answered before any rule is widened:
 *
 *   1. If punctuation stopped mattering, would two DIFFERENT products claim the same string? One
 *      collision is enough to make it unsafe — a listing attached to the wrong product pushes the
 *      wrong stock figure to a live marketplace.
 *   2. How much of "still buyable" is real? eBay and OnBuy report no listing status at all, so
 *      `deriveListingStatus` falls through to the quantity and every one of their rows reads as
 *      live. Counting those beside Amazon's answered ones overstates the urgent pile.
 *
 * Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const { buildSkuOwnerIndex, normaliseSku } = require('./.compiled/sku-match.cjs');
const { deriveListingStatus } = require('./.compiled/listing-status.cjs');

const squash = (s) => normaliseSku(s).replace(/[^a-z0-9]/g, '');

(async () => {
  const p = new PrismaClient();
  const products = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const index = buildSkuOwnerIndex(products);

  // ── 1. collisions ─────────────────────────────────────────────────────────
  const owners = new Map();
  for (const [k, owner] of index) {
    const q = squash(k);
    if (!q) continue;
    const seen = owners.get(q) ?? [];
    if (!seen.some((o) => o.productId === owner.productId)) seen.push(owner);
    owners.set(q, seen);
  }
  const collisions = [...owners.entries()].filter(([, o]) => o.length > 1);
  console.log(`\n  1. If punctuation stopped mattering\n`);
  console.log(`     ${index.size} known SKUs squash to ${owners.size} distinct strings`);
  console.log(`     SKUs that would become ambiguous: ${collisions.length}`);
  for (const [q, o] of collisions.slice(0, 15)) {
    console.log(`        "${q}" is claimed by ${o.length}: ${o.map((x) => x.sku).join('  vs  ')}`);
  }
  if (!collisions.length) console.log(`        none — no two products differ only by punctuation`);

  // ── 2. how much of "buyable" is actually answered ─────────────────────────
  const rows = await p.channelListing.findMany({
    where: { productId: null },
    select: {
      channelSku: true, listedQuantity: true, listingStatus: true, fulfilmentChannel: true,
      listedPrice: true, lastPulledAt: true,
      integration: { select: { name: true, channelType: true } },
    },
  });
  const kinds = {
    'amazon says buyable': new Set(),
    'amazon says not buyable': new Set(),
    'channel reports no status, has stock': new Set(),
    'channel reports no status, no stock': new Set(),
  };
  for (const r of rows) {
    const sku = normaliseSku(r.channelSku);
    if (r.listingStatus != null) {
      kinds[deriveListingStatus(r) === 'paused' ? 'amazon says not buyable' : 'amazon says buyable'].add(sku);
    } else {
      kinds[(r.listedQuantity ?? 0) > 0 ? 'channel reports no status, has stock' : 'channel reports no status, no stock'].add(sku);
    }
  }
  console.log(`\n  2. What "still buyable" is actually made of\n`);
  for (const [k, set] of Object.entries(kinds)) console.log(`     ${k.padEnd(38)} ${String(set.size).padStart(5)} SKU(s)`);

  /** A SKU is worth chasing if SOMEWHERE it is answered-buyable, or unanswered but carrying stock. */
  const worth = new Set([...kinds['amazon says buyable'], ...kinds['channel reports no status, has stock']]);
  console.log(`\n     worth chasing (either of the two above)   ${String(worth.size).padStart(5)} SKU(s)`);

  const stale = await p.channelListing.aggregate({ where: { productId: null }, _min: { lastPulledAt: true }, _max: { lastPulledAt: true } });
  console.log(`\n     oldest unlinked row pulled ${stale._min.lastPulledAt?.toISOString().slice(0, 10) ?? '—'}`
    + `, newest ${stale._max.lastPulledAt?.toISOString().slice(0, 10) ?? '—'}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
