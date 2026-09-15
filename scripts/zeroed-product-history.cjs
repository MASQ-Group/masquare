/**
 * The whole story of each product whose eBay listings were zeroed while they still showed stock.
 *
 *   REPORT=zeroed-product-history bash scripts/prod-scan.sh
 *
 * The push audit says a zero was sent; it cannot say why availability held zero in the first place.
 * That answer is in the order of events: every availability movement (with its reason and order
 * reference) and every quantity push, interleaved on one timeline per product, from the day the
 * product entered availability. Read against the rules — stock rises only by a person, a sale
 * lowers it and is pushed, an order for a product outside availability is ignored — any step that
 * is none of those stands out.
 *
 * Reads only. Order references and SKUs only; no customer data.
 */
const { PrismaClient } = require('@prisma/client');

const SINCE = new Date(process.env.SINCE || '2026-09-01T00:00:00Z');

(async () => {
  const p = new PrismaClient();
  const ebay = await p.channelIntegration.findMany({ where: { channelType: 'ebay' }, select: { id: true } });

  const zeroed = await p.channelPush.findMany({
    where: {
      integrationId: { in: ebay.map((e) => e.id) }, field: 'quantity', dryRun: false,
      requestedValue: 0, previousValue: { gt: 0 }, createdAt: { gte: SINCE },
    },
    select: { productId: true },
  });
  const ids = [...new Set(zeroed.map((z) => z.productId).filter(Boolean))];
  console.log(`${ids.length} products zeroed over real stock on eBay since ${SINCE.toISOString().slice(0, 10)}\n`);

  const products = await p.product.findMany({ where: { id: { in: ids } }, select: { id: true, mainSku: true } });
  const integrations = await p.channelIntegration.findMany({ select: { id: true, name: true, channelType: true } });
  const chan = (id) => integrations.find((i) => i.id === id)?.name ?? '?';
  const users = await p.user.findMany({ select: { id: true, email: true } });
  const who = (id) => (id ? (users.find((u) => u.id === id)?.email ?? id.slice(0, 8)).split('@')[0] : 'system');

  const tally = {};
  for (const prod of products.sort((a, b) => a.mainSku.localeCompare(b.mainSku))) {
    const [ledger, pushes, avail] = await Promise.all([
      p.availabilityLedger.findMany({
        where: { productId: prod.id },
        orderBy: { createdAt: 'asc' },
        select: { delta: true, newQuantity: true, reason: true, note: true, refType: true, createdAt: true, createdById: true },
      }),
      p.channelPush.findMany({
        where: { productId: prod.id, field: 'quantity', dryRun: false },
        orderBy: { createdAt: 'asc' },
        select: { integrationId: true, marketplace: true, requestedValue: true, previousValue: true, ok: true, message: true, createdAt: true, createdById: true },
      }),
      p.productAvailability.findUnique({ where: { productId: prod.id }, select: { quantity: true, lastSource: true } }),
    ]);

    console.log(`=== ${prod.mainSku}   availability now ${avail ? avail.quantity : 'no row'}`);
    const events = [
      ...ledger.map((l) => ({ at: l.createdAt, line:
        `  AVAIL ${l.createdAt.toISOString().slice(0, 16)}  ${(l.delta >= 0 ? '+' : '') + l.delta}`.padEnd(30)
        + ` -> ${String(l.newQuantity).padEnd(4)} ${l.reason.padEnd(20)} ${who(l.createdById).padEnd(12)} ${(l.note ?? '').slice(0, 50)}` })),
    ];
    // Pushes collapsed per minute and value: eight marketplaces receiving the same figure is one decision.
    const groups = new Map();
    for (const x of pushes) {
      const key = `${x.createdAt.toISOString().slice(0, 16)}|${x.requestedValue}|${x.ok}|${who(x.createdById)}|${(x.message ?? '').startsWith('restore') ? 'restore' : ''}`;
      const g = groups.get(key) ?? { at: x.createdAt, n: 0, prev: new Set(), markets: [], x };
      g.n += 1;
      g.prev.add(x.previousValue);
      g.markets.push(`${chan(x.integrationId)}${x.marketplace ? ' ' + x.marketplace : ''}`);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      events.push({ at: g.at, line:
        `  PUSH  ${g.at.toISOString().slice(0, 16)}  set ${g.x.requestedValue} (was ${[...g.prev].join('/')})`.padEnd(46)
        + ` ${g.x.ok ? 'ok' : 'FAILED'}  ${who(g.x.createdById).padEnd(10)} ${g.n} listing(s)${(g.x.message ?? '').startsWith('restore') ? '  RESTORE TOOL' : ''}` });
    }
    events.sort((a, b) => a.at - b.at);
    // Recent history is what matters; the full count is still stated so nothing reads as the beginning.
    const shown = events.filter((e) => e.at >= new Date(SINCE.getTime() - 14 * 864e5));
    if (shown.length < events.length) console.log(`  (${events.length - shown.length} earlier events not shown)`);
    for (const e of shown) console.log(e.line);
    for (const l of ledger) tally[l.reason] = (tally[l.reason] ?? 0) + 1;
    console.log('');
  }

  console.log('LEDGER REASONS ACROSS THESE PRODUCTS (all time)');
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`);
  await p.$disconnect();
})();
