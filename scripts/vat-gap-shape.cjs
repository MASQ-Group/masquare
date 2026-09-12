/** Which Amazon orders carry VAT and which do not, split by fulfilment. Reads only. */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const since = new Date(Date.now() - 120 * 24 * 3600 * 1000);
  const rows = await p.salesTransaction.findMany({
    where: { deletedAt: null, source: 'amazon', date: { gte: since }, resolution: { not: 'cancelled' },
      destinationVatPct: { gt: 0 }, vatCollectedByChannel: false },
    select: { transactionRef: true, fulfilmentType: true, date: true, destinationVatPct: true,
      salesChannel: { select: { name: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, salesTaxAmount: true, netSalesAmount: true } } },
  });
  const bucket = new Map();
  for (const t of rows) {
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const rep = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    const net = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    const k = `${t.fulfilmentType ?? '—'}`;
    const b = bucket.get(k) ?? { withVat: 0, noVat: 0, noVatNet: 0, noVatReported: 0 };
    if (vat > 0) b.withVat += 1;
    else { b.noVat += 1; b.noVatNet += net; if (rep > 0) b.noVatReported += 1; }
    bucket.set(k, b);
  }
  console.log(`\n  Amazon orders to a rated destination, last 120 days, marketplace not remitting\n`);
  for (const [k, b] of bucket) {
    console.log(`    ${k.padEnd(5)} with VAT ${String(b.withVat).padStart(5)}   without ${String(b.noVat).padStart(4)}`
      + `   (net ${b.noVatNet.toFixed(2)}, of which ${b.noVatReported} DO have a channel-reported tax figure)`);
  }

  /** If it were fulfilment, one channel would not show both shapes for the same type. */
  const byCh = new Map();
  for (const t of rows) {
    if (t.fulfilmentType !== 'FBM') continue;
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const k = t.salesChannel?.name ?? '—';
    const b = byCh.get(k) ?? { withVat: 0, noVat: 0 };
    if (vat > 0) b.withVat += 1; else b.noVat += 1;
    byCh.set(k, b);
  }
  console.log(`\n  FBM only, per channel — does the same channel show both shapes?\n`);
  for (const [k, b] of [...byCh.entries()].sort((a, c) => (c[1].withVat + c[1].noVat) - (a[1].withVat + a[1].noVat))) {
    console.log(`    ${k.padEnd(16)} with VAT ${String(b.withVat).padStart(4)}   without ${String(b.noVat).padStart(4)}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
