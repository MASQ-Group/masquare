/**
 * SKUs live on a sales channel that the platform cannot find.
 *
 *   node scripts/unmatched-listings.cjs
 *
 * These are the blind spot. A listing with no product behind it can never be tracked: it holds no
 * availability figure, no sale can deduct from it, and no push can correct it — it simply advertises
 * whatever the marketplace last recorded, indefinitely. It is also invisible to the reconcile
 * worklist, which compares availability against listings and therefore only sees listings that HAVE
 * a product.
 *
 * A listing is unmatched when `productId` is null, which is how a channel pull leaves any SKU it
 * could not tie to the catalogue. The same channel SKU usually appears on several marketplaces, so
 * rows are grouped by SKU and the marketplaces are listed against it.
 *
 * Quantity matters for the order of work: a SKU still advertising units is actively sellable and
 * unmanaged, while one at zero is dormant. The first group is the one that can oversell.
 *
 * Writes a CSV beside itself and nothing to the database.
 */
const fs = require('fs');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  const who = await prisma.$queryRaw`select current_database() as db`;
  const totalListings = await prisma.channelListing.count();

  const unmatched = await prisma.channelListing.findMany({
    where: { productId: null },
    select: {
      channelSku: true, marketplace: true, title: true, asin: true, externalListingId: true,
      listedQuantity: true, listedPrice: true, currency: true, lastPulledAt: true,
      integration: { select: { name: true, channelType: true } },
    },
  });

  /**
   * Grouped by SKU, because one SKU on eight marketplaces is one product to create, not eight.
   * The quantity kept is the HIGHEST any marketplace shows — that is the number of units that can
   * still be sold without the platform knowing.
   */
  const bySku = new Map();
  for (const l of unmatched) {
    const key = l.channelSku.trim();
    if (!bySku.has(key)) {
      bySku.set(key, {
        sku: key, title: l.title ?? null, asin: l.asin ?? null,
        maxQty: 0, channels: new Set(), price: l.listedPrice ?? null, currency: l.currency ?? null,
        lastPulledAt: l.lastPulledAt ?? null,
      });
    }
    const g = bySku.get(key);
    g.maxQty = Math.max(g.maxQty, l.listedQuantity ?? 0);
    g.channels.add(`${l.integration?.name ?? l.integration?.channelType ?? 'channel'}${l.marketplace ? ` ${l.marketplace}` : ''}`);
    if (!g.title && l.title) g.title = l.title;
    if (!g.asin && l.asin) g.asin = l.asin;
    if (g.price == null && l.listedPrice != null) { g.price = l.listedPrice; g.currency = l.currency; }
    if (l.lastPulledAt && (!g.lastPulledAt || l.lastPulledAt > g.lastPulledAt)) g.lastPulledAt = l.lastPulledAt;
  }

  const rows = [...bySku.values()].sort((a, b) => b.maxQty - a.maxQty || a.sku.localeCompare(b.sku));
  const sellable = rows.filter((r) => r.maxQty > 0);
  const dormant = rows.filter((r) => r.maxQty === 0);

  console.log(`Reading ${who[0].db}\n`);
  console.log(`  listings in total                                 ${totalListings}`);
  console.log(`  listings with no product behind them              ${unmatched.length}`);
  console.log(`  distinct SKUs they represent                      ${rows.length}`);
  console.log(`    still advertising 1 or more units               ${sellable.length}`);
  console.log(`    sitting at zero                                 ${dormant.length}\n`);

  /**
   * Not every unmatched SKU is a product waiting to be created.
   *
   * An eBay listing with no merchant SKU is pulled under a synthesized `EBAY-<itemid>`
   * identifier. Creating a catalogue product for one of those would enshrine an eBay item number
   * as a SKU; the real fix is to set a custom label on eBay, or match it to a product that
   * already exists. Counting them beside genuine SKUs would overstate the work and mislead
   * whoever picks it up.
   */
  const isEbayPlaceholder = (sku) => /^EBAY-[0-9]+$/i.test(sku);
  const realSkus = sellable.filter((r) => !isEbayPlaceholder(r.sku));
  const placeholders = sellable.filter((r) => isEbayPlaceholder(r.sku));
  console.log(`    of the sellable, genuine merchant SKUs           ${realSkus.length}`);
  console.log(`    of the sellable, eBay listings with no SKU       ${placeholders.length}`);
  console.log('      (those want a custom label on eBay, not a new product here)\n');

  console.log('  The sellable ones, highest quantity first:\n');
  console.log(`  ${'SKU'.padEnd(30)}${'QTY'.padStart(5)}  ${'CHANNELS'.padEnd(9)} TITLE`);
  for (const r of sellable.slice(0, 60)) {
    console.log(`  ${r.sku.slice(0, 29).padEnd(30)}${String(r.maxQty).padStart(5)}  ${String(r.channels.size).padEnd(9)} ${(r.title ?? '').slice(0, 60)}`);
  }
  if (sellable.length > 60) console.log(`  … and ${sellable.length - 60} more, all in the CSV.`);

  const out = path.join(__dirname, '..', 'unmatched-listings.csv');
  const header = ['sku', 'kind', 'max_quantity_on_any_channel', 'channel_count', 'channels', 'title', 'asin', 'price', 'currency', 'last_pulled'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.sku,
      isEbayPlaceholder(r.sku) ? 'ebay listing without a SKU' : 'merchant SKU',
      r.maxQty, r.channels.size, [...r.channels].join(' | '), r.title, r.asin,
      r.price, r.currency, r.lastPulledAt ? r.lastPulledAt.toISOString().slice(0, 10) : '',
    ].map(csvCell).join(','));
  }
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`\n  Full list written to ${out}`);

  await app.close();
})().catch(async (e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
