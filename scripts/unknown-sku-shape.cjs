/**
 * What the unknown listing SKUs actually ARE, before anyone decides what to do about them.
 *
 *   REPORT=unknown-sku-shape bash scripts/prod-scan.sh
 *
 * A listing whose SKU the catalogue cannot name an owner for is invisible to the availability push.
 * That is stock somebody believes they are publishing and are not. But "2,000 of them" is a number,
 * not a plan: a dead listing nobody can buy and a live one with forty units are the same row in
 * that count and completely different work.
 *
 * So this splits them four ways — can it still be bought, is it a near-miss of a SKU we already
 * know, how many channels does one SKU span, and which channels carry them. Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const { buildSkuOwnerIndex, normaliseSku } = require('./.compiled/sku-match.cjs');
const { deriveListingStatus } = require('./.compiled/listing-status.cjs');
const { channelKey } = require('./.compiled/channel-key.cjs');

/** Letters and digits only — so punctuation, spaces and separators cannot hide a match. */
const squash = (s) => normaliseSku(s).replace(/[^a-z0-9]/g, '');

/** Progressively shorter prefixes, cut at each separator: IT51015-FBA-2 -> IT51015-FBA -> IT51015. */
function* prefixes(sku) {
  const parts = normaliseSku(sku).split(/[-_.\s]+/).filter(Boolean);
  for (let n = parts.length - 1; n >= 1; n--) yield parts.slice(0, n).join('-');
}

(async () => {
  const p = new PrismaClient();

  const products = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const index = buildSkuOwnerIndex(products);
  const squashed = new Map();
  for (const [k, owner] of index) {
    const q = squash(k);
    if (q && !squashed.has(q)) squashed.set(q, owner);
  }
  console.log(`\n  catalogue: ${products.length} products, ${index.size} known SKUs\n`);

  const rows = await p.channelListing.findMany({
    where: { productId: null },
    select: {
      channelSku: true, integrationId: true, marketplace: true, listedQuantity: true,
      listingStatus: true, fulfilmentChannel: true, listedPrice: true, lastPulledAt: true,
      integration: { select: { name: true, channelType: true } },
    },
  });

  const bySku = new Map();
  for (const r of rows) {
    const k = normaliseSku(r.channelSku);
    const e = bySku.get(k) ?? { sku: r.channelSku, rows: [], channels: new Set() };
    e.rows.push(r);
    e.channels.add(channelKey({ integrationId: r.integrationId, marketplace: r.marketplace }));
    bySku.set(k, e);
  }

  // ── Is it still purchasable anywhere? ─────────────────────────────────────
  const live = [], dead = [];
  for (const e of bySku.values()) {
    const statuses = e.rows.map((r) => deriveListingStatus(r));
    (statuses.some((s) => s === 'live' || s === 'low' || s === 'oos') ? live : dead).push({ ...e, statuses });
  }

  console.log(`  ${rows.length} unlinked listing row(s), ${bySku.size} distinct SKU(s)\n`);
  console.log(`    still buyable somewhere   ${String(live.length).padStart(5)} SKU(s)   <- the ones that cost money`);
  console.log(`    nothing buyable anywhere  ${String(dead.length).padStart(5)} SKU(s)   <- paused or ended everywhere`);

  // ── Does the catalogue nearly know it? ────────────────────────────────────
  const buckets = { 'punctuation only': [], 'suffix on a known SKU': [], 'genuinely unknown': [] };
  for (const e of bySku.values()) {
    const owner = squashed.get(squash(e.sku));
    if (owner) { buckets['punctuation only'].push({ ...e, owner }); continue; }
    let hit = null;
    for (const pre of prefixes(e.sku)) {
      const o = index.get(pre) ?? squashed.get(squash(pre));
      if (o) { hit = { pre, o }; break; }
    }
    if (hit) buckets['suffix on a known SKU'].push({ ...e, owner: hit.o, matched: hit.pre });
    else buckets['genuinely unknown'].push(e);
  }

  console.log(`\n  how close is the catalogue?\n`);
  for (const [label, list] of Object.entries(buckets)) {
    const liveCount = list.filter((e) => e.rows.some((r) => ['live', 'low', 'oos'].includes(deriveListingStatus(r)))).length;
    console.log(`    ${label.padEnd(24)} ${String(list.length).padStart(5)} SKU(s)   (${liveCount} still buyable)`);
    for (const e of list.slice(0, 6)) {
      const qty = e.rows.reduce((s, r) => s + (r.listedQuantity ?? 0), 0);
      console.log(`        ${String(e.sku).padEnd(26)} ${e.channels.size} channel(s), qty ${qty}`
        + (e.owner ? `  -> ${e.owner.sku}${e.matched ? ` (via ${e.matched})` : ''}` : ''));
    }
  }

  // ── Where are they? ───────────────────────────────────────────────────────
  const byChannel = new Map();
  for (const r of rows) {
    const name = r.integration?.name ?? '—';
    const k = r.marketplace ? `${name} ${r.marketplace}` : name;
    const b = byChannel.get(k) ?? { rows: 0, buyable: 0 };
    b.rows += 1;
    if (['live', 'low', 'oos'].includes(deriveListingStatus(r))) b.buyable += 1;
    byChannel.set(k, b);
  }
  console.log(`\n  by channel\n`);
  for (const [k, b] of [...byChannel.entries()].sort((a, c) => c[1].rows - a[1].rows).slice(0, 20)) {
    console.log(`    ${k.padEnd(28)} ${String(b.rows).padStart(5)} row(s)   ${String(b.buyable).padStart(5)} buyable`);
  }

  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
