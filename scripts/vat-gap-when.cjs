/** When the no-VAT Amazon orders happened, and when we last touched them. Reads only. */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const rows = await p.salesTransaction.findMany({
    where: { deletedAt: null, source: 'amazon', resolution: { not: 'cancelled' },
      destinationVatPct: { gt: 0 }, vatCollectedByChannel: false,
      date: { gte: new Date(Date.now() - 365 * 24 * 3600 * 1000) } },
    select: { date: true, createdAt: true, updatedAt: true, channelShipmentStatus: true,
      items: { where: { deletedAt: null }, select: { vatAmount: true } } },
  });
  const by = new Map();
  for (const t of rows) {
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const k = t.date.toISOString().slice(0, 7);
    const b = by.get(k) ?? { withVat: 0, noVat: 0 };
    if (vat > 0) b.withVat += 1; else b.noVat += 1;
    by.set(k, b);
  }
  console.log(`\n  by order month — with VAT vs without\n`);
  for (const [k, b] of [...by.entries()].sort()) {
    const pct = ((b.noVat / (b.withVat + b.noVat)) * 100).toFixed(0);
    console.log(`    ${k}   with ${String(b.withVat).padStart(4)}   without ${String(b.noVat).padStart(4)}   ${pct.padStart(3)}% missing`);
  }

  const noVat = rows.filter((t) => t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0) === 0);
  const gapDays = noVat.map((t) => (+t.updatedAt - +t.createdAt) / 86400000);
  const same = gapDays.filter((d) => d < 0.02).length;
  console.log(`\n  of ${noVat.length} without VAT:`);
  console.log(`    never touched after import        ${same}`);
  console.log(`    still not_shipped on the channel  ${noVat.filter((t) => t.channelShipmentStatus !== 'shipped').length}`);
  const lastTouch = noVat.map((t) => t.updatedAt.toISOString().slice(0, 10));
  const tally = new Map();
  for (const d of lastTouch) tally.set(d, (tally.get(d) ?? 0) + 1);
  console.log(`\n  last touched on\n`);
  for (const [d, n] of [...tally.entries()].sort().slice(-6)) console.log(`    ${d}  ${n}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
