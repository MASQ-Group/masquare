/**
 * Orders imported while Amazon still had them Pending, and what they are carrying meanwhile.
 *
 *   REPORT=pending-window bash scripts/prod-scan.sh
 *
 * Amazon withholds an order's tax while it sits in Pending — `ItemPrice` arrives, `ItemTax` does
 * not — and withholds the shipping address with it. So a pending order lands with its VAT at zero,
 * its net OVERSTATED by the tax the buyer actually paid, and its destination guessed as the
 * marketplace's own country.
 *
 * None of that is permanent: incremental syncs filter on `LastUpdatedAfter`, so leaving Pending
 * re-fetches the order and `importMappedOrder` updates the row. This measures the window, not a
 * defect — how many orders are sitting in it right now, and for how much.
 *
 * Reads only.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const rows = await p.salesTransaction.findMany({
    where: {
      deletedAt: null, source: 'amazon', date: { gte: since },
      resolution: { not: 'cancelled' },
      destinationVatPct: { gt: 0 },
      vatCollectedByChannel: false,
      items: { every: { OR: [{ vatAmount: 0 }, { vatAmount: null }] } },
    },
    select: {
      transactionRef: true, date: true, status: true, currency: true, destinationVatPct: true,
      fulfilmentType: true, channelShipmentStatus: true, createdAt: true, updatedAt: true,
      destinationCountry: { select: { isoCode: true } },
      salesChannel: { select: { name: true, nativeCountry: { select: { isoCode: true } } } },
      items: { where: { deletedAt: null }, select: { netSalesAmount: true, quantity: true } },
    },
    orderBy: { date: 'desc' },
  });

  console.log(`\n  ${rows.length} Amazon order(s) in the last 30 days carrying NO VAT on a rated destination\n`);
  let net = 0;
  for (const t of rows.slice(0, 25)) {
    const n = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    net += n;
    const homeIso = t.salesChannel?.nativeCountry?.isoCode;
    console.log(`    ${t.date.toISOString().slice(0, 10)}  ${t.transactionRef}  ${String(t.salesChannel?.name).padEnd(12)}`
      + ` -> ${t.destinationCountry?.isoCode}${homeIso === t.destinationCountry?.isoCode ? ' (= marketplace, may be the fallback)' : ''}`
      + `  ${t.status}/${t.channelShipmentStatus}  ${t.fulfilmentType}  net ${n.toFixed(2)} ${t.currency} at ${t.destinationVatPct}%`);
  }
  for (const t of rows.slice(25)) net += t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
  console.log(`\n    net across all of them: ${net.toFixed(2)} (mixed currencies)`);

  /** How quickly they leave the window, judged by whether anything has touched them since import. */
  const untouched = rows.filter((t) => Math.abs(+t.updatedAt - +t.createdAt) < 1000).length;
  console.log(`    never updated since import: ${untouched} of ${rows.length}`);
  console.log(`    (an order that left Pending would have been re-saved by a later sync)\n`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
