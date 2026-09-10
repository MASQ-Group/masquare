/**
 * Settling the backlog left by "a draft order consumes stock", without subtracting the past twice.
 *
 *   node scripts/draft-backfill.cjs                       # report only — writes nothing
 *   node scripts/draft-backfill.cjs --mark-availability   # bookkeeping only, availability lines
 *   node scripts/draft-backfill.cjs --mark-stock          # bookkeeping only, stock lines
 *   node scripts/draft-backfill.cjs --apply               # move both, for orders after the count
 *
 * ── Why a cut-off ───────────────────────────────────────────────────────────────
 * A reconcile only runs when an order is saved, so every existing draft still holds nothing. The
 * obvious fix — reconcile them all — is wrong, and the first version of this script proposed
 * exactly that: on live data it would have driven 42 of 65 tracked products to zero and pushed
 * those zeros to the marketplaces.
 *
 * The reason is that a figure someone typed is a CURRENT count. It already reflects every sale to
 * date. Product BE-HT15 was counted at 5 on 10 September; replaying its 29 historical orders would
 * subtract sales the 5 already accounted for. And on the stock side a short balance also mints
 * StockOwed rows — debts claiming we sold goods never received.
 *
 * So each product gets a cut-off: the last moment somebody vouched for its figure.
 *
 *   availability — the newest `manual_set` or `vendor_import` in the availability ledger
 *   stock        — the newest `stocktake`, `opening_balance` or `adjustment` movement
 *
 * An order dated on or before that is ALREADY IN THE NUMBER: mark it accounted, move nothing.
 * An order after it is genuinely unreconciled: it may move.
 *
 * No anchor at all means nobody ever counted this product, so nothing can be said about what its
 * figure includes. Those are treated as accounted — when in doubt, do not move stock.
 *
 * ── Availability and stock are not the same kind of number ──────────────────────
 * Availability is a SNAPSHOT: somebody types a figure and it stands until retyped. It therefore
 * already contains every sale up to the moment it was typed, and replaying those sales double
 * counts. The cut-off is unarguable here.
 *
 * Stock is a LEDGER: the balance is the sum of its movements. A sale that never deducted leaves the
 * balance genuinely too high, and applying it would CORRECT the books rather than corrupt them —
 * unless a stocktake or adjustment has already absorbed the gap, which is exactly what the stock
 * anchors detect.
 *
 * So marking is offered separately for each. Marking availability is safe; marking stock locks in
 * an overstatement if nobody has been correcting balances by hand. That is a question about how the
 * warehouse is actually run, not one this script can answer.
 *
 * ── What --mark writes, and the one thing it gives up ───────────────────────────
 * It sets the line's deducted quantities to match, so a later save cannot take the units again.
 * `stockWarehouseId` is deliberately left alone: choosing one now would invent a provenance these
 * units never had. The cost is that such a line can no longer give stock BACK — reconcileSaleLine
 * skips the release when there is no warehouse. Acceptable here: these are shipped historical
 * orders, and a reversal of one is neither expected nor correct.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');
const { SalesTransactionsService } = require('../apps/api/dist/src/sales-transactions/sales-transactions.service');

const markAvailability = process.argv.includes('--mark-availability');
const markStock = process.argv.includes('--mark-stock');
const mark = markAvailability || markStock;
const apply = process.argv.includes('--apply');

/** Figures a person or a vendor file vouched for — never a movement caused by trade. */
const AVAILABILITY_ANCHORS = ['manual_set', 'vendor_import'];
const STOCK_ANCHORS = ['stocktake', 'opening_balance', 'adjustment'];

/**
 * `quantity` is a Prisma Decimal, so `Number.isInteger` on it is false for every row — which had an
 * earlier version of this report announce that nothing needed doing at all.
 */
const whole = (q) => {
  const n = Number(q);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
};

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  // Per-product cut-offs, one query each rather than one per product.
  const [availAnchors, stockAnchors] = await Promise.all([
    prisma.availabilityLedger.groupBy({
      by: ['productId'], where: { reason: { in: AVAILABILITY_ANCHORS } }, _max: { createdAt: true },
    }),
    prisma.stockMovement.groupBy({
      by: ['productId'], where: { reason: { in: STOCK_ANCHORS } }, _max: { createdAt: true },
    }),
  ]);
  const availCutoff = new Map(availAnchors.map((a) => [a.productId, a._max.createdAt]));
  const stockCutoff = new Map(stockAnchors.map((a) => [a.productId, a._max.createdAt]));

  const lines = await prisma.salesTransactionItem.findMany({
    where: {
      deletedAt: null,
      productId: { not: null },
      transaction: { deletedAt: null, resolution: 'none', fulfilmentType: { not: 'FBA' } },
    },
    select: {
      id: true, sku: true, productId: true, quantity: true,
      availabilityDeductedQty: true, stockDeductedQty: true,
      transaction: { select: { id: true, transactionRef: true, date: true } },
      product: { select: { mainSku: true, serialTracked: true, availability: { select: { quantity: true } } } },
    },
  });

  const markLines = { avail: [], stock: [] };
  const applyTxIds = new Set();
  const moving = new Map();      // productId -> what would actually move
  let accountedLines = 0, noAnchorLines = 0, fractional = 0;

  for (const l of lines) {
    const units = whole(l.quantity);
    if (units === null) { fractional += 1; continue; }
    const availOutstanding = units - l.availabilityDeductedQty;
    const stockOutstanding = l.product?.serialTracked ? 0 : units - l.stockDeductedQty;
    if (availOutstanding <= 0 && stockOutstanding <= 0) continue;

    const placed = l.transaction.date;
    const aCut = availCutoff.get(l.productId);
    const sCut = stockCutoff.get(l.productId);
    // No anchor → nothing is known about what the current figure includes → do not move.
    const availAfter = aCut ? placed > aCut : false;
    const stockAfter = sCut ? placed > sCut : false;

    if (availOutstanding > 0 && !availAfter) markLines.avail.push({ id: l.id, units });
    if (stockOutstanding > 0 && !stockAfter) markLines.stock.push({ id: l.id, units });
    if (!aCut && !sCut) noAnchorLines += 1; else if (!availAfter && !stockAfter) accountedLines += 1;

    if ((availOutstanding > 0 && availAfter) || (stockOutstanding > 0 && stockAfter)) {
      applyTxIds.add(l.transaction.id);
      const cur = moving.get(l.productId) ?? {
        mainSku: l.product?.mainSku ?? l.sku,
        inAvailability: l.product?.availability != null,
        have: l.product?.availability?.quantity ?? null,
        countedOn: aCut ?? null,
        avail: 0, stock: 0, orders: new Set(),
      };
      if (availAfter) cur.avail += Math.max(0, availOutstanding);
      if (stockAfter) cur.stock += Math.max(0, stockOutstanding);
      cur.orders.add(l.transaction.transactionRef ?? l.transaction.id);
      moving.set(l.productId, cur);
    }
  }

  const movers = [...moving.values()];
  const trackedMovers = movers.filter((m) => m.inAvailability && m.avail > 0);
  const wouldFloor = trackedMovers.filter((m) => (m.have ?? 0) < m.avail);

  console.log(`${apply ? 'APPLY' : mark ? 'MARK' : 'REPORT'} — backlog since drafts began consuming stock\n`);
  console.log('ALREADY IN THE COUNT — to be marked, nothing moves');
  console.log(`  lines dated on or before the product's last count   ${accountedLines}`);
  console.log(`  lines whose product was never counted               ${noAnchorLines}`);
  console.log(`  availability lines to mark                          ${markLines.avail.length}`);
  console.log(`  stock lines to mark                                 ${markLines.stock.length}`);
  console.log('\nGENUINELY UNRECONCILED — placed after the count, so not yet in the figure');
  console.log(`  orders                                             ${applyTxIds.size}`);
  console.log(`  products                                           ${movers.length}`);
  console.log(`  availability units to take                         ${movers.reduce((s, m) => s + m.avail, 0)}`);
  console.log(`  stock units to take                                ${movers.reduce((s, m) => s + m.stock, 0)}`);
  if (fractional) console.log(`  fractional lines skipped                           ${fractional}`);

  if (wouldFloor.length) {
    console.log(`\n  ${wouldFloor.length} product(s) would still be driven to zero — worth a look before applying:`);
    for (const m of wouldFloor.sort((a, b) => b.avail - a.avail).slice(0, 15)) {
      console.log(`    ${String(m.mainSku).padEnd(24)} counted ${day(m.countedOn)}  have ${String(m.have).padStart(4)}  take ${String(m.avail).padStart(4)}`);
    }
  }
  if (trackedMovers.length) {
    console.log('\n  Availability movements:');
    for (const m of trackedMovers.sort((a, b) => b.avail - a.avail).slice(0, 20)) {
      console.log(`    ${String(m.mainSku).padEnd(24)} counted ${day(m.countedOn)}  have ${String(m.have).padStart(4)}  take ${String(m.avail).padStart(4)}  ->  ${String(Math.max(0, (m.have ?? 0) - m.avail)).padStart(4)}`);
    }
  }

  if (!mark && !apply) {
    console.log('\nNothing was written.');
    console.log('  --mark-availability  settles the availability bookkeeping (nothing moves)');
    console.log('  --mark-stock         settles the stock bookkeeping (nothing moves)');
    console.log('  --apply              moves both, for the genuinely unreconciled group');
    await app.close();
    return;
  }

  if (mark) {
    /**
     * Bookkeeping only. Each line is told it has already accounted for its units, so no later save
     * takes them a second time. No ledger entry and no movement: nothing physical happened here,
     * and writing one would be the double count in another form.
     */
    let done = 0;
    for (const l of markLines.avail) {
      await prisma.salesTransactionItem.update({ where: { id: l.id }, data: { availabilityDeductedQty: l.units } });
      if (++done % 500 === 0) console.log(`  availability ${done}/${markLines.avail.length}`);
    }
    done = 0;
    for (const l of markLines.stock) {
      await prisma.salesTransactionItem.update({ where: { id: l.id }, data: { stockDeductedQty: l.units } });
      if (++done % 500 === 0) console.log(`  stock ${done}/${markLines.stock.length}`);
    }
    console.log(`\nMarked ${markLines.avail.length} availability line(s) and ${markLines.stock.length} stock line(s). Nothing moved.`);
  }

  if (apply) {
    // Through the ordinary save path, so the backfill cannot drift from the live rules.
    const sales = app.get(SalesTransactionsService);
    let done = 0;
    for (const txId of applyTxIds) {
      await sales['reconcileSaleStock'](txId).catch((e) => console.error(`stock ${txId}: ${e?.message ?? e}`));
      await sales['applyAvailabilitySellThrough'](txId).catch((e) => console.error(`availability ${txId}: ${e?.message ?? e}`));
      if (++done % 100 === 0) console.log(`  ${done}/${applyTxIds.size}`);
    }
    console.log(`\nReconciled ${done} order(s).`);
  }

  await app.close();
})().catch((e) => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
