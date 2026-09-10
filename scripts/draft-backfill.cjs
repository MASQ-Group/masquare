/**
 * What changes now that a DRAFT order consumes stock and availability.
 *
 *   node --env-file=.env scripts/draft-backfill.cjs            # dry run — writes nothing
 *   node --env-file=.env scripts/draft-backfill.cjs --apply    # reconcile them for real
 *
 * Draft used to release its units, on the reading that an unsubmitted order had not really
 * happened. It is a completeness tag — some final figure is still missing, usually the settled
 * sales fee — and channel orders arrive as drafts already shipped. The rule now matches that.
 *
 * A reconcile only runs when a transaction is saved, so the change is not retroactive: every
 * existing draft still holds nothing, and stock and availability both overstate what is on hand
 * until each is touched. This is the pass that settles them.
 *
 * The dry run is the point. It deducts across the whole catalogue in one go and the new figures go
 * out to the channels straight afterwards, so the size of it should be seen before it happens —
 * particularly the products that would be driven to zero.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');
const { SalesTransactionsService } = require('../apps/api/dist/src/sales-transactions/sales-transactions.service');

const apply = process.argv.includes('--apply');

/**
 * Whole units only: stock, availability and movements are all integer. Mirrors wholeUnitsForStock.
 *
 * `quantity` arrives as a Prisma Decimal, not a number, so `Number.isInteger` on it is false for
 * EVERY row — which had this report cheerfully announce that nothing needed doing at all. A dry run
 * that says "no work" when there are thousands of lines is the worst possible failure for a report
 * whose entire job is to size the work.
 */
const whole = (q) => {
  const n = Number(q);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
};

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  /**
   * Every line that would move: a live, uncancelled order holding fewer units than it should.
   *
   * Not filtered to drafts. A submitted order that never reconciled is in exactly the same state
   * and wants exactly the same correction — filtering by status would fix the symptom we noticed
   * and leave its twin behind.
   */
  const lines = await prisma.salesTransactionItem.findMany({
    where: {
      deletedAt: null,
      productId: { not: null },
      transaction: { deletedAt: null, resolution: 'none', fulfilmentType: { not: 'FBA' } },
    },
    select: {
      id: true, sku: true, productId: true, quantity: true,
      availabilityDeductedQty: true, stockDeductedQty: true,
      transaction: { select: { id: true, transactionRef: true, status: true } },
      product: { select: { mainSku: true, serialTracked: true, availability: { select: { quantity: true } } } },
    },
  });

  const byProduct = new Map();
  const txIds = new Set();
  let fractional = 0;

  for (const l of lines) {
    const units = whole(l.quantity);
    if (units === null) { fractional += 1; continue; }
    const availMove = units - l.availabilityDeductedQty;
    const stockMove = l.product?.serialTracked ? 0 : units - l.stockDeductedQty;
    if (availMove <= 0 && stockMove <= 0) continue;

    txIds.add(l.transaction.id);
    const key = l.productId;
    const cur = byProduct.get(key) ?? {
      mainSku: l.product?.mainSku ?? l.sku,
      // Null means the product is not in availability at all — nothing to deduct from, and the
      // platform deliberately records nothing rather than inventing a row.
      inAvailability: l.product?.availability != null,
      have: l.product?.availability?.quantity ?? null,
      availMove: 0, stockMove: 0, orders: new Set(),
    };
    cur.availMove += Math.max(0, availMove);
    cur.stockMove += Math.max(0, stockMove);
    cur.orders.add(l.transaction.transactionRef ?? l.transaction.id);
    byProduct.set(key, cur);
  }

  const rows = [...byProduct.values()];
  const tracked = rows.filter((r) => r.inAvailability);
  const wouldFloor = tracked.filter((r) => (r.have ?? 0) < r.availMove);

  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — draft and unreconciled orders\n`);
  console.log(`orders affected            ${txIds.size}`);
  console.log(`products affected          ${rows.length}`);
  console.log(`  of those, in availability ${tracked.length}`);
  console.log(`availability units to take ${tracked.reduce((s, r) => s + r.availMove, 0)}`);
  console.log(`stock units to take        ${rows.reduce((s, r) => s + r.stockMove, 0)}`);
  if (fractional) console.log(`fractional lines skipped   ${fractional}`);

  if (wouldFloor.length) {
    console.log(`\n${wouldFloor.length} product(s) would be driven to zero — the deduction exceeds what is recorded:`);
    for (const r of wouldFloor.sort((a, b) => b.availMove - a.availMove).slice(0, 20)) {
      console.log(`  ${String(r.mainSku).padEnd(24)} have ${String(r.have).padStart(4)}  take ${String(r.availMove).padStart(4)}  (${r.orders.size} order(s))`);
    }
    if (wouldFloor.length > 20) console.log(`  … and ${wouldFloor.length - 20} more`);
  }

  if (tracked.length) {
    console.log('\nLargest availability movements:');
    for (const r of tracked.sort((a, b) => b.availMove - a.availMove).slice(0, 15)) {
      console.log(`  ${String(r.mainSku).padEnd(24)} have ${String(r.have).padStart(4)}  take ${String(r.availMove).padStart(4)}  ->  ${String(Math.max(0, (r.have ?? 0) - r.availMove)).padStart(4)}`);
    }
  }

  if (!apply) {
    console.log('\nNothing was written. Re-run with --apply to reconcile these orders.');
    await app.close();
    return;
  }

  // Apply: reconcile each order through the ordinary path, so it takes exactly the same route a
  // save would — no second implementation of the rules to drift from the first.
  const sales = app.get(SalesTransactionsService);
  let done = 0;
  for (const txId of txIds) {
    await sales['reconcileSaleStock'](txId).catch((e) => console.error(`stock ${txId}: ${e?.message ?? e}`));
    await sales['applyAvailabilitySellThrough'](txId).catch((e) => console.error(`availability ${txId}: ${e?.message ?? e}`));
    if (++done % 200 === 0) console.log(`  ${done}/${txIds.size}`);
  }
  console.log(`\nReconciled ${done} order(s).`);
  await app.close();
})().catch((e) => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
