/**
 * Does the chain work? A read-only report on the whole path from sale to marketplace.
 *
 *   node scripts/prod-health.cjs
 *
 * The chain has four links, and a break in any one looks identical from the outside — the channel
 * keeps advertising stock that is gone:
 *
 *   1. a sale is recorded
 *   2. availability drops
 *   3. a push is queued for that product
 *   4. the push reaches the channel and is accepted
 *
 * Each link is gated by its own setting and fails in its own way, so this reports them separately
 * rather than as one verdict. Writes nothing.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');
const { AvailabilityService } = require('../apps/api/dist/src/availability/availability.service');

const ago = (h) => new Date(Date.now() - h * 3600_000);
const line = (label, value) => console.log(`  ${label.padEnd(46)}${value}`);
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const availability = app.get(AvailabilityService);

  const who = await prisma.$queryRaw`select current_database() as db, inet_server_addr()::text as host`;
  console.log(`Reading ${who[0].db} at ${who[0].host ?? 'local socket'}\n`);

  // ── The switches ─────────────────────────────────────────────────────────
  const s = await prisma.platformSettings.findFirst({
    select: {
      deductStockOnSale: true,
      autoAdjustAvailabilityOnSale: true,
      channelQuantityPushEnabled: true,
      autoCorrectChannelQuantity: true,
    },
  });
  head('Settings');
  line('Deduct STOCK on sale (warehouses)', s?.deductStockOnSale ? 'ON' : 'OFF');
  line('Adjust AVAILABILITY on sale', s?.autoAdjustAvailabilityOnSale ? 'ON' : 'OFF');
  line('Send quantities to channels', s?.channelQuantityPushEnabled ? 'ON' : 'OFF');
  line('Hourly sweep may CORRECT drift', s?.autoCorrectChannelQuantity ? 'ON' : 'OFF');

  // ── Link 1 & 2: sales, and whether availability moved ────────────────────
  head('Sales and availability, last 24h');
  const recentSales = await prisma.salesTransaction.count({ where: { date: { gte: ago(24) }, deletedAt: null } });
  line('sales transactions dated in the last 24h', recentSales);

  const led = await prisma.availabilityLedger.groupBy({
    by: ['reason'], where: { createdAt: { gte: ago(24) } }, _count: { _all: true },
  });
  if (!led.length) console.log('    (no availability movements at all in 24h)');
  for (const r of led.sort((a, b) => b._count._all - a._count._all)) line(`  ledger: ${r.reason}`, r._count._all);
  line('products currently in availability', await prisma.productAvailability.count());

  // ── Link 3: the push queue ───────────────────────────────────────────────
  head('Push queue (what we still owe the channels)');
  const pending = await prisma.channelPushQueue.count({ where: { attempts: { lt: 5 } } });
  const stuck = await prisma.channelPushQueue.count({ where: { attempts: { gte: 5 } } });
  line('pending (will be drained)', pending);
  line('stuck (gave up after 5 attempts)', stuck);
  const oldest = await prisma.channelPushQueue.findFirst({
    orderBy: { enqueuedAt: 'asc' },
    select: { enqueuedAt: true, attempts: true, lastError: true, product: { select: { mainSku: true } } },
  });
  if (oldest) {
    line('oldest owed', `${oldest.product?.mainSku ?? '?'} since ${oldest.enqueuedAt.toISOString().slice(0, 16)}, ${oldest.attempts} attempt(s)`);
    if (oldest.lastError) line('  its last error', oldest.lastError.slice(0, 60));
  }

  // ── Link 4: did anything actually reach a marketplace? ───────────────────
  head('Pushes actually sent');
  for (const h of [24, 24 * 7]) {
    const ok = await prisma.channelPush.count({ where: { createdAt: { gte: ago(h) }, field: 'quantity', dryRun: false, ok: true } });
    const bad = await prisma.channelPush.count({ where: { createdAt: { gte: ago(h) }, field: 'quantity', dryRun: false, ok: false } });
    line(`last ${h === 24 ? '24h' : '7 days'}`, `${ok} accepted, ${bad} refused`);
  }
  const lastPush = await prisma.channelPush.findFirst({
    where: { field: 'quantity', dryRun: false }, orderBy: { createdAt: 'desc' },
    select: { createdAt: true, marketplace: true, channelSku: true, previousValue: true, requestedValue: true, ok: true, message: true },
  });
  line('most recent quantity push', lastPush
    ? `${lastPush.createdAt.toISOString().slice(0, 16)} ${lastPush.channelSku} ${lastPush.previousValue}->${lastPush.requestedValue} ${lastPush.ok ? 'ok' : 'REFUSED'}`
    : 'never');
  const fails = await prisma.channelPush.findMany({
    where: { createdAt: { gte: ago(24 * 7) }, field: 'quantity', dryRun: false, ok: false },
    select: { message: true }, take: 200,
  });
  if (fails.length) {
    const by = {};
    for (const f of fails) { const k = (f.message ?? '').slice(0, 70); by[k] = (by[k] ?? 0) + 1; }
    console.log('    why they were refused:');
    for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`      ${String(n).padStart(4)}  ${k}`);
  }

  // ── The outcome that matters ─────────────────────────────────────────────
  head('Are the channels in step right now?');
  const drift = await availability.drift({ pageSize: 10 });
  line('products advertising a quantity we do not hold', drift.total);
  line('listings involved', drift.channelCount);
  for (const d of drift.items.slice(0, 8)) {
    const worst = Math.max(...d.channels.map((c) => (c.listedQuantity ?? 0) - (d.held ?? 0)));
    console.log(`      ${d.mainSku.padEnd(26)} we hold ${String(d.held).padEnd(4)} ${d.channels.length} channel(s) disagree, up to +${worst}`);
  }

  /**
   * Zero has two meanings, and the worklist above cannot tell them apart on its own.
   *
   * A product COUNTED at zero really is out of stock, and its channels should be told. A product
   * only ADDED to availability carries zero as "tracked, not yet counted" — telling a channel zero
   * for one of those asserts something nobody established, and emptying listings on an unestablished
   * zero is exactly what happened on 4 August.
   *
   * The creation row is delta 0 with that note and nothing after it; a count leaves a later
   * manual_set or vendor_import.
   */
  head('Of those, which zeros are real?');
  const zeroIds = drift.items.map((d) => d.productId);
  const allDrift = await availability.drift({ pageSize: 1000 });
  const ids = allDrift.items.filter((d) => (d.held ?? 0) === 0).map((d) => d.productId);
  const counts = await prisma.availabilityLedger.groupBy({
    by: ['productId'],
    where: { productId: { in: ids }, reason: { in: ['manual_set', 'vendor_import'] }, delta: { not: 0 } },
    _count: { _all: true },
  });
  const counted = new Set(counts.map((c) => c.productId));
  line('products at zero in the drift list', ids.length);
  line('  COUNTED at zero — safe to tell the channels', ids.filter((i) => counted.has(i)).length);
  line('  never counted — zero means "unknown"', ids.filter((i) => !counted.has(i)).length);
  void zeroIds;

  await app.close();
})().catch(async (e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
