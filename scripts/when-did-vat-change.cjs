/** When did these orders' lines last change, and what touched them. */
const { PrismaClient } = require('@prisma/client');
const REFS = ['203-3360683-2041963', '206-2860516-4425912', '203-7969606-1817906', '205-7531231-6213941', '203-0088884-9520307'];
(async () => {
  const p = new PrismaClient();
  const txs = await p.salesTransaction.findMany({
    where: { transactionRef: { in: REFS } },
    select: { id: true, transactionRef: true, updatedAt: true, vatCollectedByChannel: true, destinationVatPct: true,
      items: { select: { vatAmount: true, salesTaxAmount: true, updatedAt: true } } },
  });
  for (const t of txs) {
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    const itemTouched = t.items.map((i) => i.updatedAt).sort().slice(-1)[0];
    console.log(`  ${t.transactionRef}  flag=${t.vatCollectedByChannel}  rate=${t.destinationVatPct}%  vat=${vat.toFixed(2)}  salesTax=${tax.toFixed(2)}`);
    console.log(`      tx updated ${t.updatedAt.toISOString().slice(0, 19)}   items updated ${itemTouched?.toISOString().slice(0, 19)}`);
  }
  const recent = await p.salesTransactionItem.count({ where: { updatedAt: { gte: new Date(Date.now() - 6 * 3600 * 1000) } } });
  const recentTx = await p.salesTransaction.count({ where: { updatedAt: { gte: new Date(Date.now() - 6 * 3600 * 1000) } } });
  console.log(`\n  items updated in the last 6h: ${recent}    transactions: ${recentTx}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
