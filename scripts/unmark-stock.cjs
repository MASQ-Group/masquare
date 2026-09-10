/**
 * Undo stock lines marked by mistake.
 *
 *   node scripts/unmark-stock.cjs --scan                                    # when did marking happen?
 *   node scripts/unmark-stock.cjs --since "<ISO>"                           # report only
 *   node scripts/unmark-stock.cjs --since "<ISO>" --apply                   # put them back
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────
 * `draft-backfill.cjs` gated its marking on `mark`, which is `markAvailability || markStock`, and
 * then marked BOTH. So `--mark-availability` also wrote `stockDeductedQty` — on production, 112
 * stock lines nobody asked to touch. The flag bug is fixed; this is for the rows it already wrote.
 *
 * Marking stock is not a cosmetic act. A line marked as already-deducted will never deduct again, so
 * if the balances were NOT already short by those units the stock figures stay permanently
 * overstated. That is the decision the backfill was explicitly not supposed to take on its own.
 *
 * ── It does not assume the previous value ───────────────────────────────────────
 * The obvious reversal — set the count back to zero — would be a guess: the line might legitimately
 * have deducted something before. So each candidate is checked against the stock LEDGER, which is
 * the independent record of whether stock ever actually moved for that order and product.
 *
 *   no 'sale' movement for that reference and product  -> nothing was ever deducted -> reset to 0
 *   a movement exists                                  -> left alone and reported
 *
 * `--since` is required and is compared against the item's `updatedAt`, so only rows touched by the
 * bad run are considered. Pass the time just BEFORE that run.
 *
 * Start with `--scan`, which needs no window and shows when fully-marked lines were last touched.
 * Guessing the window is worse than not knowing it: too late and the run reports zero, which reads
 * exactly like "nothing to undo" when it means "wrong window". That already happened once.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');

const apply = process.argv.includes('--apply');
const scan = process.argv.includes('--scan');
const sinceArg = process.argv[process.argv.indexOf('--since') + 1];

const whole = (q) => {
  const n = Number(q);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
};

(async () => {
  if (scan) {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const prisma = app.get(PrismaService);

    /**
     * Every line that currently claims to have deducted its whole quantity, grouped by the DAY it
     * was last touched. The marking run shows up as a spike; ordinary trading does not.
     */
    const rows = await prisma.salesTransactionItem.findMany({
      where: { stockDeductedQty: { gt: 0 } },
      select: { quantity: true, stockDeductedQty: true, updatedAt: true },
    });
    const full = rows.filter((l) => {
      const units = whole(l.quantity);
      return units !== null && l.stockDeductedQty === units;
    });

    const byDay = new Map();
    for (const l of full) {
      const d = l.updatedAt.toISOString().slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }

    console.log('SCAN — lines claiming a full stock deduction, by the day they were last touched\n');
    console.log(`  lines with any stock deduction recorded           ${rows.length}`);
    console.log(`  of those, deducted in full                        ${full.length}\n`);
    for (const [d, n] of [...byDay.entries()].sort()) {
      console.log(`  ${d}   ${String(n).padStart(6)}`);
    }
    if (full.length) {
      // The exact instants, so --since can be set from evidence rather than from a guess.
      const times = full.map((l) => l.updatedAt).sort((a, b) => a - b);
      console.log(`\n  earliest ${times[0].toISOString()}`);
      console.log(`  latest   ${times[times.length - 1].toISOString()}`);
      console.log('\n  Pass --since a moment BEFORE the spike you mean to undo.');
    } else {
      console.log('\n  Nothing claims a full stock deduction. There is nothing here to undo.');
    }
    await app.close();
    return;
  }

  if (!process.argv.includes('--since') || !sinceArg) {
    console.error('Refusing to run without --since "<ISO timestamp>". Without a window this would\n'
      + 'consider every marked line in the database, including ones marked deliberately.\n'
      + 'Run with --scan first to see when marking actually happened.');
    process.exit(1);
  }
  const since = new Date(sinceArg);
  if (Number.isNaN(since.getTime())) {
    console.error(`--since "${sinceArg}" is not a date.`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  /**
   * Candidates: lines touched inside the window that now claim to have deducted their full
   * quantity. The mark set `stockDeductedQty = units`, so anything short of that was not its doing.
   */
  const touched = await prisma.salesTransactionItem.findMany({
    where: { updatedAt: { gte: since }, stockDeductedQty: { gt: 0 } },
    select: {
      id: true, sku: true, productId: true, quantity: true, stockDeductedQty: true,
      transaction: { select: { transactionRef: true } },
    },
  });

  const candidates = touched.filter((l) => {
    const units = whole(l.quantity);
    return units !== null && l.stockDeductedQty === units;
  });

  // One query for the ledger rather than one per line.
  const refs = [...new Set(candidates.map((l) => l.transaction?.transactionRef).filter(Boolean))];
  const moves = await prisma.stockMovement.findMany({
    where: { reason: 'sale', reference: { in: refs } },
    select: { productId: true, reference: true },
  });
  const moved = new Set(moves.map((m) => `${m.productId}|${m.reference}`));

  const resettable = [];
  const keep = [];
  for (const l of candidates) {
    const key = `${l.productId}|${l.transaction?.transactionRef}`;
    (moved.has(key) ? keep : resettable).push(l);
  }

  console.log(`${apply ? 'APPLY' : 'REPORT'} — stock lines marked since ${since.toISOString()}\n`);
  console.log(`  lines touched in the window                        ${touched.length}`);
  console.log(`  of those, fully marked (what the bad run wrote)    ${candidates.length}`);
  console.log(`  no stock ever moved for them — safe to reset       ${resettable.length}`);
  console.log(`  stock DID move — left alone                        ${keep.length}`);
  for (const l of keep.slice(0, 10)) {
    console.log(`      ${l.sku} on ${l.transaction?.transactionRef}`);
  }

  if (candidates.length === 0) {
    /**
     * Zero here has two meanings and only one of them is good news. Said plainly, because a silent
     * zero already sent one run away believing there was nothing to undo when the window was simply
     * set too late.
     */
    console.log('\n  Zero can mean the window is wrong rather than that nothing was marked.');
    console.log('  Run with --scan to see when lines were actually marked.');
  }

  if (!apply) {
    console.log('\nNothing was written. Re-run with --apply to reset the safe ones to 0.');
    console.log('No stock moves either way — this only changes what each line CLAIMS to have deducted.');
    await app.close();
    return;
  }

  let done = 0;
  for (let i = 0; i < resettable.length; i += 500) {
    const batch = resettable.slice(i, i + 500);
    const r = await prisma.salesTransactionItem.updateMany({
      where: { id: { in: batch.map((l) => l.id) } },
      data: { stockDeductedQty: 0 },
    });
    done += r.count;
  }
  console.log(`\nReset ${done} line(s) to 0. No stock movement was created or deleted.`);
  await app.close();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
