/** What each channel's last sync said, and when. Reads only. */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const rows = await p.channelIntegration.findMany({
    where: { deletedAt: null, channelType: { in: ['amazon', 'ebay', 'onbuy'] } },
    select: { name: true, channelType: true, lastSyncRunAt: true, lastSyncStatus: true, lastSyncMessage: true },
    orderBy: { lastSyncRunAt: 'desc' },
  });
  console.log('');
  for (const r of rows.slice(0, 14)) {
    console.log(`  ${String(r.name).padEnd(16)} ${r.lastSyncRunAt?.toISOString().slice(0, 16) ?? 'never'}  ${r.lastSyncStatus ?? '—'}`);
    if (r.lastSyncMessage) console.log(`      ${r.lastSyncMessage.slice(0, 150)}`);
  }
  const withPending = rows.filter((r) => /pending payment/.test(r.lastSyncMessage ?? ''));
  console.log(`\n  channels reporting held-back pending orders: ${withPending.length}`);
  console.log(`  (the phrase only exists in builds since the skip shipped, so its absence means`);
  console.log(`   either no sync has run yet, or there was nothing pending when one did)\n`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
