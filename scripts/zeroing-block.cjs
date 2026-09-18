/**
 * Why is the quantity push refusing to run?
 *
 *   REPORT=zeroing-block bash scripts/prod-scan.sh
 *
 * The push refuses the whole run when it would take more than `maxZeroingPushesPerRun` listings
 * from a real quantity down to zero. That refusal is working as designed; this report answers the
 * question it raises, which is whether those listings SHOULD go to zero.
 *
 * Two very different situations produce the same refusal:
 *
 *   - The products really are out of stock. Then the channels are advertising goods we do not
 *     have, every hour the block stands, and the fix is to let the push through.
 *   - Availability is wrong — rows zeroed by something else, or never written. Then the block just
 *     saved us from emptying the shelves, and the fix is upstream.
 *
 * Telling them apart needs the stock behind each product, which is why this exists rather than a
 * glance at the log line. Read-only: it counts and prints, and writes nothing.
 */
const { PrismaClient } = require('@prisma/client');

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const num = (v, n = 6) => String(v ?? '').padStart(n);

(async () => {
  const p = new PrismaClient();

  const settings = await p.platformSettings.findFirst({
    select: { maxZeroingPushesPerRun: true, channelQuantityPushEnabled: true, deductStockOnSale: true },
  });
  const ceiling = settings?.maxZeroingPushesPerRun ?? 25;

  // ── the queue: what is owed, and for how long ────────────────────────────────────────────────
  const queued = await p.channelPushQueue.findMany({
    select: { productId: true, enqueuedAt: true, attempts: true, lastError: true, reason: true },
    orderBy: { enqueuedAt: 'asc' },
  });

  console.log(`  ceiling (maxZeroingPushesPerRun)     ${ceiling}`);
  console.log(`  quantity pushes enabled             ${settings?.channelQuantityPushEnabled}`);
  console.log(`  deduct stock on sale                ${settings?.deductStockOnSale}`);
  console.log(`  products waiting in the push queue   ${queued.length}`);
  if (queued.length) {
    const oldest = queued[0].enqueuedAt;
    const days = (Date.now() - new Date(oldest).getTime()) / 86400000;
    console.log(`  oldest debt                          ${new Date(oldest).toISOString().slice(0, 16)}  (${days.toFixed(1)} days)`);
    const blocked = queued.filter((q) => (q.lastError ?? '').includes('Refused')).length;
    console.log(`  rows whose last attempt was refused  ${blocked}`);
    const reasons = {};
    for (const q of queued) reasons[q.reason ?? '—'] = (reasons[q.reason ?? '—'] ?? 0) + 1;
    console.log(`  why they were queued                 ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  console.log('');

  if (!queued.length) {
    console.log('  Nothing is queued, so nothing is being refused right now.');
    await p.$disconnect();
    return;
  }

  // ── the listings that run would zero ─────────────────────────────────────────────────────────
  // The same conditions the guard applies, against the same columns: availability is exactly 0 and
  // the listing currently advertises more than none. FBA is excluded because Amazon owns it.
  const productIds = queued.map((q) => q.productId);
  const avails = await p.productAvailability.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, quantity: true },
  });
  const qtyBy = new Map(avails.map((a) => [a.productId, a.quantity]));

  const listings = await p.channelListing.findMany({
    where: {
      productId: { in: productIds },
      OR: [{ fulfilmentChannel: null }, { fulfilmentChannel: { not: 'FBA' } }],
    },
    select: {
      productId: true, channelSku: true, marketplace: true, listedQuantity: true,
      integration: { select: { name: true, channelType: true, marketplace: true } },
      product: { select: { mainSku: true, title: true } },
    },
  });

  const wouldZero = listings.filter((l) => {
    if (l.integration.channelType === 'ebay' && !l.marketplace) return false;
    if (l.productId == null || !qtyBy.has(l.productId)) return false;
    return qtyBy.get(l.productId) === 0 && (l.listedQuantity ?? 0) > 0;
  });

  console.log(`  listings this run would take to zero ${wouldZero.length}   (refuses above ${ceiling})`);
  const noRow = productIds.filter((id) => !qtyBy.has(id));
  console.log(`  queued products with NO availability row  ${noRow.length}   (these are skipped, not zeroed)`);
  console.log('');

  // ── is the zero real? ────────────────────────────────────────────────────────────────────────
  // A product at zero availability with stock still in a warehouse is a data fault; one with no
  // stock anywhere is genuinely sold out and its listings are overselling.
  const affected = [...new Set(wouldZero.map((l) => l.productId))];
  const stock = await p.stockLevel.groupBy({
    by: ['productId'],
    where: { productId: { in: affected } },
    _sum: { quantityOnHand: true },
  }).catch(() => null);
  const stockBy = new Map((stock ?? []).map((s) => [s.productId, s._sum.quantityOnHand ?? 0]));

  const genuinelyOut = affected.filter((id) => (stockBy.get(id) ?? 0) <= 0);
  const stillHaveStock = affected.filter((id) => (stockBy.get(id) ?? 0) > 0);

  console.log(`  products behind those listings       ${affected.length}`);
  console.log(`    availability 0 AND no stock held   ${genuinelyOut.length}   <- listings are overselling`);
  console.log(`    availability 0 BUT stock on hand   ${stillHaveStock.length}   <- availability looks wrong`);
  if (stock === null) console.log('    (stock could not be read; treat the split above as unknown)');
  console.log('');

  const byProduct = new Map();
  for (const l of wouldZero) {
    if (!byProduct.has(l.productId)) byProduct.set(l.productId, []);
    byProduct.get(l.productId).push(l);
  }

  // Units, not just listings: "45 listings" is the guard's unit, but what a customer can buy is
  // the sum of what each of them advertises, and that is the size of the exposure.
  const advertised = wouldZero.reduce((n, l) => n + (l.listedQuantity ?? 0), 0);
  console.log(`  units on sale that we do not have    ${advertised}`);
  console.log('');

  console.log(`  ${pad('SKU', 20)} ${pad('product', 30)} ${num('stock')} ${num('lists')} ${num('units')}  channels`);
  for (const id of affected.slice(0, 40)) {
    const rows = byProduct.get(id) ?? [];
    const channels = [...new Set(rows.map((r) => r.integration.name))].join(', ');
    const units = rows.reduce((n, r) => n + (r.listedQuantity ?? 0), 0);
    console.log(
      `  ${pad(rows[0]?.product?.mainSku, 20)} ${pad(rows[0]?.product?.title, 30)} ${num(stockBy.get(id) ?? 0)} ${num(rows.length)} ${num(units)}  ${channels}`,
    );
  }
  if (affected.length > 40) console.log(`  … and ${affected.length - 40} more`);

  await p.$disconnect();
})();
