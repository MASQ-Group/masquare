/** Is channel-resolution handling switched on, and what has it ever done? Reads only. */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const s = await p.platformSettings.findFirst({
    select: { applyChannelResolutions: true, listingLiveWrites: true },
  });
  console.log(`\n  applyChannelResolutions  ${s?.applyChannelResolutions ?? '(no settings row)'}`);
  console.log(`    false means the sync fetches no refunds at all and registers no cancellations\n`);

  const byRes = await p.salesTransaction.groupBy({
    by: ['resolution'], where: { deletedAt: null, source: 'amazon' }, _count: { _all: true },
  });
  console.log(`  Amazon orders by resolution\n`);
  for (const r of byRes) console.log(`    ${String(r.resolution ?? 'null').padEnd(10)} ${r._count._all}`);

  const refunded = await p.salesTransaction.count({
    where: { deletedAt: null, source: 'amazon', refundAmount: { not: null } },
  });
  const anyRes = await p.salesTransaction.count({
    where: { deletedAt: null, source: 'amazon', resolutionSource: { not: null } },
  });
  console.log(`\n  Amazon orders carrying a refund amount    ${refunded}`);
  console.log(`  Amazon orders with any resolutionSource   ${anyRes}`);
  /**
   * When refunds were last applied. The fetch walks `financialEvents` from PostedAfter with a hard
   * cap of 50 pages at 100 events — 5,000 events — and stops there SILENTLY if there are more. A
   * cliff in these dates is what that would look like.
   */
  const recent = await p.salesTransaction.findMany({
    where: { deletedAt: null, source: 'amazon', resolution: 'returned', resolvedAt: { not: null } },
    select: { transactionRef: true, date: true, resolvedAt: true, refundAmount: true,
      salesChannel: { select: { name: true } } },
    orderBy: { resolvedAt: 'desc' }, take: 12,
  });
  console.log(`
  most recently applied refunds
`);
  for (const t of recent) {
    console.log(`    resolved ${t.resolvedAt.toISOString().slice(0, 16)}  ordered ${t.date.toISOString().slice(0, 10)}`
      + `  ${String(t.salesChannel?.name).padEnd(12)} ${t.transactionRef}  ${t.refundAmount}`);
  }

  const byMonth = new Map();
  for (const t of await p.salesTransaction.findMany({
    where: { deletedAt: null, source: 'amazon', resolution: 'returned', resolvedAt: { not: null } },
    select: { resolvedAt: true },
  })) {
    const k = t.resolvedAt.toISOString().slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
  }
  console.log(`
  refunds applied per month
`);
  for (const [k, n] of [...byMonth.entries()].sort()) console.log(`    ${k}  ${n}`);

  /**
   * Which channels ever get a refund applied.
   *
   * `financialEvents` is per ENDPOINT, not per marketplace — every EU marketplace shares one — but
   * the match is `integrationId: row.id`. So each EU sync fetches the whole account's EU refunds and
   * keeps only its own, discarding the rest. A channel that never appears here is one whose refunds
   * something else is consuming, or never reaching.
   */
  const rows = await p.salesTransaction.findMany({
    where: { deletedAt: null, source: 'amazon' },
    select: { resolution: true, salesChannel: { select: { name: true } } },
  });
  const by = new Map();
  for (const t of rows) {
    const k = t.salesChannel?.name ?? '—';
    const b = by.get(k) ?? { orders: 0, returned: 0 };
    b.orders += 1;
    if (t.resolution === 'returned') b.returned += 1;
    by.set(k, b);
  }
  console.log(`
  refunds applied, per channel
`);
  for (const [k, b] of [...by.entries()].sort((a, c) => c[1].orders - a[1].orders)) {
    console.log(`    ${k.padEnd(14)} ${String(b.orders).padStart(5)} orders   ${String(b.returned).padStart(4)} returned`
      + (b.returned === 0 ? '   <- never' : ''));
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
