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
 * I had said these rows could not be re-derived. They can. Each carries its ORDER REFERENCE in the
 * note, and the order still says what state it is in. The rule itself lives in the API, with tests:
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
    select: { id: true, note: true, delta: true, productId: true },
  });

  const refs = [...new Set(rows.map((r) => (r.note ?? '').trim()).filter(Boolean))];
  const txs = await prisma.salesTransaction.findMany({
    where: { transactionRef: { in: refs } },
    select: { transactionRef: true, status: true, resolution: true },
  });

  /**
   * One reference can appear on more than one order — the same channel order id under two
   * companies, for instance. Only a unanimous reading is usable; a split one is recorded as
   * ambiguous rather than resolved by picking whichever row came back first.
   */
  const byRef = new Map();
  for (const t of txs) {
    if (!byRef.has(t.transactionRef)) byRef.set(t.transactionRef, t);
    else if (byRef.get(t.transactionRef)?.status !== t.status) byRef.set(t.transactionRef, null);
  }

  const relabel = [];
  const tally = { unmatched: 0, ambiguous: 0, left: 0 };
  const leftBy = {};
  for (const r of rows) {
    const t = byRef.get((r.note ?? '').trim());
    if (t === undefined) { tally.unmatched += 1; continue; }
    if (t === null) { tally.ambiguous += 1; continue; }

    const reason = legacyAvailabilityReason({ found: true, status: t.status });
    if (reason) relabel.push({ id: r.id, reason });
    else {
      tally.left += 1;
      const k = `${t.status}/${t.resolution ?? 'none'}`;
      leftBy[k] = (leftBy[k] ?? 0) + 1;
    }
  }

  console.log(`${apply ? 'APPLY' : 'REPORT'} — legacy "cancellation" rows in the availability ledger\n`);
  console.log(`  rows carrying the legacy reason                    ${rows.length}`);
  console.log(`  provable — the order is still a draft              ${relabel.length}  -> order_not_submitted`);
  console.log(`  left vague — cause genuinely unknowable            ${tally.left}`);
  for (const [k, v] of Object.entries(leftBy).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(v).padStart(5)}  ${k}`);
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
