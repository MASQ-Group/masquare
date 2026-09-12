/** REGULAR/SELLER orders where we record VAT and Amazon's report says zero. */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
(async () => {
  const facts = JSON.parse(fs.readFileSync(process.env.FACTS, 'utf8')).amazonEu;
  const p = new PrismaClient();
  const refs = Object.entries(facts).filter(([, f]) => f.scheme === 'REGULAR' && f.resp === 'SELLER').map(([r]) => r);
  const rows = await p.salesTransaction.findMany({
    where: { deletedAt: null, transactionRef: { in: refs } },
    select: { transactionRef: true, date: true, taxType: true, destinationVatPct: true, vatOverridden: true,
      destinationCountry: { select: { isoCode: true, euVatZone: true } },
      salesChannel: { select: { name: true, nativeCountry: { select: { isoCode: true } } } },
      items: { where: { deletedAt: null }, select: { netSalesAmount: true, vatAmount: true, shippingAmountVat: true, salesTaxAmount: true } } },
  });
  console.log('  REGULAR/SELLER where ours > 0 and Amazon says 0:\n');
  let n = 0, sum = 0;
  const byDest = {};
  for (const t of rows) {
    const f = facts[t.transactionRef];
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
    const theirs = f.vat + f.shipVat;
    if (vat <= 0.02 || Math.abs(theirs) > 0.02) continue;
    n += 1; sum += vat;
    const net = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    const k = `${t.salesChannel?.name} -> ${t.destinationCountry?.isoCode}`;
    byDest[k] = (byDest[k] ?? 0) + 1;
    if (n <= 12) {
      console.log(`    ${t.transactionRef}  ${String(t.salesChannel?.name).padEnd(11)} -> ${t.destinationCountry?.isoCode}`
        + `  net ${net.toFixed(2).padStart(8)}  ourVat ${vat.toFixed(2).padStart(7)}  salesTax ${tax.toFixed(2).padStart(7)}`
        + `  rate ${t.destinationVatPct ?? '—'}%  amazonNet ${f.net.toFixed(2)}  ${t.date.toISOString().slice(0, 10)}`);
    }
  }
  console.log(`\n  ${n} order(s), ${sum.toFixed(2)} of VAT we claim and Amazon does not`);
  console.log('\n  by channel and destination:');
  for (const [k, v] of Object.entries(byDest).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
