/**
 * Re-deriving the cause of the legacy `cancellation` rows in the availability ledger.
 *
 *   node scripts/relabel-legacy-availability.cjs           # report only — writes nothing
 *   node scripts/relabel-legacy-availability.cjs --apply   # rewrite the reason where it is provable
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────
 * The sell-through used to take the ledger's reason from the sign of the movement, so every release
 * was filed as `cancellation`. The ledger view then showed those rows as "Returned", which asserts
 * that a customer sent goods back — about orders that shipped and were never returned by anyone.
 *
 * I had said these rows could not be re-derived. They can, two different ways. Each carries its
 * ORDER REFERENCE in the note, the order still says what state it is in, and — the stronger signal —
 * the ledger itself records what happened next. An update that replaces an order's item rows
 * returns their availability and re-deducts inside the same request, so an edit leaves a release
 * and a matching retake about ten milliseconds apart.
 *
 * The rule lives in the API, with tests:
 * apps/api/src/availability/legacy-availability-reason.ts.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────────
 * This only ever UPDATEs `reason` on rows that already read `cancellation`. It creates nothing,
 * deletes nothing, and touches no quantity — so no figure moves and no push to a channel follows.
 * Rows whose cause cannot be proved are left exactly as they are.
 *
 * `refId` is NOT used as the key. It looks like the right one and is stale: a channel re-sync
 * recreates transactions with fresh ids, so on live data those references resolve to nothing at all.
 * `transactionRef`, carried in the note, survives.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');
const {
  legacyAvailabilityReason,
} = require('../apps/api/dist/src/availability/legacy-availability-reason');

const apply = process.argv.includes('--apply');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  const rows = await prisma.availabilityLedger.findMany({
    where: { reason: 'cancellation' },
    select: { id: true, note: true, delta: true, productId: true, createdAt: true },
  });

  /**
   * Every sale row, keyed by product + order reference, so a release can be matched to the retake
   * that undid it. One pass and a map rather than a query per row — there are thousands of these.
   */
  const sales = await prisma.availabilityLedger.findMany({
    where: { reason: 'sale' },
    select: { productId: true, note: true, delta: true, createdAt: true },
  });
  const salesByKey = new Map();
  for (const s of sales) {
    const k = `${s.productId}|${(s.note ?? '').trim()}`;
    if (!salesByKey.has(k)) salesByKey.set(k, []);
    salesByKey.get(k).push(s);
  }

  /**
   * How long after a release the same quantity was taken back, or null if it never was.
   *
   * The size has to match. A release of +1 answered by a sale of -1 is the two halves of one edit;
   * a release of +1 followed by a -3 is a different sale altogether and proves nothing about this
   * row.
   */
  const retakenAfterMs = (r) => {
    const after = (salesByKey.get(`${r.productId}|${(r.note ?? '').trim()}`) ?? [])
      .filter((s) => s.createdAt > r.createdAt && s.delta === -r.delta);
    if (!after.length) return null;
    return Math.min(...after.map((s) => s.createdAt - r.createdAt));
  };

  const purge = await prisma.availabilityLedger.aggregate({
    where: { reason: 'purge' }, _max: { createdAt: true },
  });
  const purgedAt = purge._max.createdAt ?? null;
  const beforePurge = purgedAt ? rows.filter((r) => r.createdAt < purgedAt).length : 0;

  const refs = [...new Set(rows.map((r) => (r.note ?? '').trim()).filter(Boolean))];
  const txs = await prisma.salesTransaction.findMany({
    where: { transactionRef: { in: refs } },
    select: {
      id: true, transactionRef: true, status: true, resolution: true, deletedAt: true,
      // Live lines only. An edit soft-deletes the rows it replaces, so the absence of a live line
      // for a product is exactly the evidence that an edit dropped it.
      items: { where: { deletedAt: null }, select: { productId: true, availabilityDeductedQty: true } },
    },
  });

  /**
   * One reference can appear on more than one order — the same channel order id under two
   * companies, for instance. Only a unanimous reading is usable; a split one is recorded as
   * ambiguous rather than resolved by picking whichever row came back first.
   */
  const byRef = new Map();
  for (const t of txs) {
    const seen = byRef.get(t.transactionRef);
    if (seen === undefined) { byRef.set(t.transactionRef, t); continue; }
    // Deletedness counts as disagreement too: one deleted and one live order behind the same
    // reference read as different causes, and picking either would be a coin toss.
    if (seen && (seen.status !== t.status || !!seen.deletedAt !== !!t.deletedAt)) {
      byRef.set(t.transactionRef, null);
    }
  }

  const relabel = [];
  const tally = { unmatched: 0, ambiguous: 0, left: 0 };
  const provable = { released: 0, order_edited: 0, order_line_removed: 0, order_not_submitted: 0 };
  const leftBy = {};
  const residue = {};
  const probe = {};
  const bump = (k) => { probe[k] = (probe[k] ?? 0) + 1; };
  for (const r of rows) {
    const t = byRef.get((r.note ?? '').trim());
    if (t === undefined) { tally.unmatched += 1; continue; }
    if (t === null) { tally.ambiguous += 1; continue; }

    const line = t.items.find((i) => i.productId === r.productId);
    const reason = legacyAvailabilityReason({
      found: true,
      status: t.status,
      deleted: !!t.deletedAt,
      retakenAfterMs: retakenAfterMs(r),
      hasLiveLine: !!line,
    });
    if (reason) { relabel.push({ id: r.id, reason }); provable[reason] += 1; }
    else {
      tally.left += 1;
      const k = `${t.status}/${t.resolution ?? 'none'}`;
      leftBy[k] = (leftBy[k] ?? 0) + 1;
      /**
       * What the surviving line holds TODAY. Not a cause — the report refuses to name one for these
       * — but it separates two very different residues: a line still holding nothing looks like a
       * release that was never reconciled, while one holding units was settled later by something.
       */
      const state = (line?.availabilityDeductedQty ?? 0) > 0 ? 'line now holds units' : 'line still holds nothing';
      residue[state] = (residue[state] ?? 0) + 1;

      /**
       * Diagnostic, not a cause: is there ANY later sale for this order and product?
       *
       * The retake test demands an exact opposite delta inside five seconds. If most of the residue
       * turns out to have a later sale that simply misses one of those conditions, the test is too
       * strict and can be widened on evidence. If there is no later sale at all, the test is right
       * and these releases really were never undone. The two call for opposite work, and guessing
       * which is which is how the labels went wrong in the first place.
       */
      const later = (salesByKey.get(`${r.productId}|${(r.note ?? '').trim()}`) ?? [])
        .filter((sale) => sale.createdAt > r.createdAt);
      if (!later.length) {
        bump('  ...no later sale for this order and product at all');
      } else {
        const gapMs = Math.min(...later.map((sale) => sale.createdAt - r.createdAt));
        // Bucketed. Printing the exact gap gives one line per row, which is a dump rather than a
        // finding — the first version of this did exactly that.
        const when = gapMs <= 5000 ? 'within 5s'
          : gapMs <= 60_000 ? 'within a minute'
          : gapMs <= 3_600_000 ? 'within an hour'
          : gapMs <= 86_400_000 ? 'within a day'
          : 'a day or more later';
        bump(`  ...a later sale ${when}, but it did not pair (size or window)`);
      }
    }
  }

  console.log(`${apply ? 'APPLY' : 'REPORT'} — legacy "cancellation" rows in the availability ledger\n`);
  console.log(`  rows carrying the legacy reason                    ${rows.length}`);
  console.log(`  provable — the order was deleted                   ${provable.released}  -> released`);
  console.log(`  provable — units returned and retaken by an edit    ${provable.order_edited}  -> order_edited`);
  console.log(`  provable — an edit dropped the product             ${provable.order_line_removed}  -> order_line_removed`);
  console.log(`  provable — the order is still a draft              ${provable.order_not_submitted}  -> order_not_submitted`);
  console.log(`  left vague — cause genuinely unknowable            ${tally.left}`);
  for (const [k, v] of Object.entries(leftBy).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(v).padStart(5)}  ${k}`);
  }
  for (const [k, v] of Object.entries(residue).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(v).padStart(5)}  ${k}`);
  }
  for (const [k, v] of Object.entries(probe).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(v).padStart(5)}${k}`);
  }

  /**
   * Why "no later sale" is not evidence that the units were never taken back.
   *
   * `adjust` opens with `if (!current) return null` — a product with no availability row moves
   * nothing and writes NO ledger entry, while the order line's `availabilityDeductedQty` is updated
   * either way. The purge emptied that table, so every reconcile after it against a purged product
   * deducted the line silently.
   *
   * The ledger is therefore severed at the purge, and no rule can recover what happened across it.
   * This line exists so the next person to look does not repeat the investigation.
   */
  if (purgedAt) {
    console.log(`
  Availability was purged ${purgedAt.toISOString().slice(0, 16)}, and ${beforePurge} of these rows predate it.`);
    console.log('  A deduction against a product with no availability row writes no ledger entry, so a');
    console.log('  retake after the purge leaves no trace here. "No later sale" is not proof of no retake.');
  }
  if (tally.unmatched) console.log(`  no order behind the note                           ${tally.unmatched}`);
  if (tally.ambiguous) console.log(`  reference shared by disagreeing orders             ${tally.ambiguous}`);

  if (!apply) {
    console.log('\nNothing was written.  Re-run with --apply to rewrite the provable rows.');
    console.log('No quantity is touched either way — this changes what the history SAYS, not what it holds.');
    await app.close();
    return;
  }

  // Grouped by target reason so this is a couple of statements rather than 1,300 round trips.
  const byReason = new Map();
  for (const r of relabel) {
    if (!byReason.has(r.reason)) byReason.set(r.reason, []);
    byReason.get(r.reason).push(r.id);
  }

  let written = 0;
  for (const [reason, ids] of byReason) {
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const res = await prisma.availabilityLedger.updateMany({
        // Re-stating the old reason makes a second run a no-op instead of a second rewrite.
        where: { id: { in: batch }, reason: 'cancellation' },
        data: { reason },
      });
      written += res.count;
    }
  }

  console.log(`\nRewrote ${written} row(s). Quantities untouched; nothing was created or deleted.`);
  await app.close();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
