/** The 14.54 still showing on the Australia sheet — which order, and where is it going? */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
(async () => {
  const facts = JSON.parse(fs.readFileSync(process.env.FACTS, 'utf8')).AmazonAUS;
  const p = new PrismaClient();
  const rows = await p.salesTransaction.findMany({
    where: { deletedAt: null, transactionRef: { in: Object.keys(facts) },
      items: { some: { deletedAt: null, OR: [{ vatAmount: { gt: 0 } }, { shippingAmountVat: { gt: 0 } }] } } },
    select: { transactionRef: true, taxType: true, vatCollectedByChannel: true, currency: true, destinationVatPct: true,
      destinationCountry: { select: { isoCode: true, name: true, euVatZone: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, shippingAmountVat: true, salesTaxAmount: true } } },
  });
  for (const t of rows) {
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    const f = facts[t.transactionRef];
    console.log(`  ${t.transactionRef}  dest=${t.destinationCountry?.isoCode} (${t.destinationCountry?.name})`
      + `  regime=${t.taxType}  flag=${t.vatCollectedByChannel}  rate=${t.destinationVatPct}  ${t.currency}`
      + `\n      ours ${vat.toFixed(2)}   channel reported ${tax.toFixed(2)}   amazon sheet says ${(f.itemTax + f.shipTax).toFixed(2)} -> ${f.dest}`);
  }
  if (!rows.length) console.log('  nothing');
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
