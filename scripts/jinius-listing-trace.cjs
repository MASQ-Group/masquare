/**
 * Why a product that IS on Jinius reads as not listed here.
 *
 *   REPORT=jinius-listing-trace bash scripts/prod-scan.sh
 *
 * Read-only. Written when 92-QP420/50 was live on Jinius with 4 units and the platform, after a
 * listings sync, showed it as not listed there.
 *
 * Three things can produce that one symptom, and they have different fixes, so the report separates
 * them rather than reporting "not listed":
 *   1. no row at all        - the offer never came back in the pull
 *   2. a row with no product - it came back under a SKU the catalogue does not hold verbatim
 *   3. a row that is linked  - then the fault is in how the row is read, not in the pull
 */
const { PrismaClient } = require('@prisma/client');

/** Letters and digits only, the same squash the listings matcher uses. */
const loose = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

(async () => {
  const p = new PrismaClient();
  const integrations = await p.channelIntegration.findMany({
    where: { channelType: 'jinius', deletedAt: null },
    select: { id: true, name: true, status: true },
  });
  if (!integrations.length) { console.log('No Jinius connection.'); await p.$disconnect(); return; }

  for (const intg of integrations) {
    const rows = await p.channelListing.findMany({
      where: { integrationId: intg.id },
      select: { channelSku: true, productId: true, listedQuantity: true, listedPrice: true, listingStatus: true, lastPulledAt: true },
    });
    const linked = rows.filter((r) => r.productId).length;
    console.log(`${intg.name} (${intg.status}): ${rows.length} listing row(s), ${linked} linked to a product, ${rows.length - linked} not.`);
    const pulled = rows.map((r) => r.lastPulledAt).filter(Boolean).sort();
    if (pulled.length) console.log(`  last pulled ${pulled[pulled.length - 1].toISOString()}`);

    /**
     * What we stored as the listing status.
     *
     * The field's contract is Amazon's buyability array, or NULL for a channel that does not report
     * one. Anything else that is not null reads as "not buyable" everywhere it is used.
     */
    const byStatus = new Map();
    for (const r of rows) byStatus.set(r.listingStatus, (byStatus.get(r.listingStatus) ?? 0) + 1);
    console.log('  listingStatus values held:');
    for (const [s, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
      const reads = s == null ? 'null - falls through to the quantity' : `"${s}" - does not contain BUYABLE, so it reads as paused`;
      console.log(`    ${n} x ${reads}`);
    }
  }

  // The product that prompted this, and anything on Jinius that squashes to the same letters.
  const WANTED = '92-QP420/50';
  const key = loose(WANTED);
  const product = await p.product.findFirst({
    where: { deletedAt: null, OR: [{ mainSku: WANTED }, { aliases: { some: { skuValue: WANTED, deletedAt: null } } }] },
    select: { id: true, mainSku: true, title: true, ean: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  console.log(`\n${WANTED}`);
  if (!product) {
    console.log('  no product here holds that SKU, as a main SKU or an alias.');
  } else {
    console.log(`  product ${product.mainSku} - ${product.title ?? ''} (ean ${product.ean ?? '—'})`);
    console.log(`  aliases: ${product.aliases.map((a) => a.skuValue).join(', ') || 'none'}`);
    const its = await p.channelListing.findMany({
      where: { productId: product.id },
      select: { channelSku: true, marketplace: true, listedQuantity: true, listingStatus: true, integration: { select: { name: true, channelType: true } } },
    });
    console.log(`  listing rows attached to it: ${its.length}`);
    for (const l of its) console.log(`    ${l.integration.channelType} ${l.integration.name} ${l.channelSku}${l.marketplace ? ` [${l.marketplace}]` : ''} qty=${l.listedQuantity ?? '—'} status=${l.listingStatus ?? 'null'}`);
  }

  // Every Jinius row whose SKU squashes to the same letters and digits, linked or not.
  const jiniusIds = integrations.map((i) => i.id);
  const all = await p.channelListing.findMany({
    where: { integrationId: { in: jiniusIds } },
    select: { channelSku: true, productId: true, listedQuantity: true, listedPrice: true, listingStatus: true },
  });
  const near = all.filter((r) => loose(r.channelSku) === key || loose(r.channelSku).includes('qp420'));
  console.log(`  Jinius rows matching those letters: ${near.length}`);
  for (const r of near) console.log(`    "${r.channelSku}" product=${r.productId ? 'linked' : 'NOT LINKED'} qty=${r.listedQuantity ?? '—'} price=${r.listedPrice ?? '—'} status=${r.listingStatus ?? 'null'}`);

  /**
   * Unlinked Jinius SKUs the catalogue would recognise if punctuation were ignored.
   *
   * The account sync links a row only on an exact SKU match, so a slash for a hyphen leaves a live
   * offer attached to nothing - invisible on the product, and unreachable by the stock push.
   */
  const products = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const byLoose = new Map();
  for (const pr of products) {
    for (const s of [pr.mainSku, ...pr.aliases.map((a) => a.skuValue)]) {
      const k = loose(s);
      if (!k) continue;
      const seen = byLoose.get(k);
      if (seen && seen.id !== pr.id) byLoose.set(k, null); // several products claim it: do not guess
      else if (!seen) byLoose.set(k, { id: pr.id, sku: pr.mainSku });
    }
  }
  const unlinked = all.filter((r) => !r.productId);
  const recoverable = unlinked.filter((r) => byLoose.get(loose(r.channelSku)));
  console.log(`\nUnlinked Jinius rows: ${unlinked.length}, of which ${recoverable.length} match a product once punctuation is ignored.`);
  for (const r of recoverable.slice(0, 20)) {
    console.log(`  "${r.channelSku}" -> ${byLoose.get(loose(r.channelSku)).sku}`);
  }
  const hopeless = unlinked.filter((r) => !byLoose.get(loose(r.channelSku)));
  console.log(`Unlinked and matching nothing here: ${hopeless.length}`);
  for (const r of hopeless.slice(0, 15)) console.log(`  "${r.channelSku}" qty=${r.listedQuantity ?? '—'}`);

  await p.$disconnect();
})();
