/** Orders we flag as channel-collected that Amazon's own report calls SELLER — the risky direction. */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
(async () => {
  const facts = JSON.parse(fs.readFileSync(process.env.FACTS, 'utf8')).amazonEu;
  const p = new PrismaClient();
  const refs = Object.entries(facts).filter(([, f]) => f.resp === 'SELLER').map(([r]) => r);
  const rows = [];
  for (let i = 0; i < refs.length; i += 1000) {
    rows.push(...await p.salesTransaction.findMany({
      where: { deletedAt: null, transactionRef: { in: refs.slice(i, i + 1000) }, vatCollectedByChannel: true },
      select: { transactionRef: true, date: true, taxType: true, destinationVatPct: true,
        destinationCountry: { select: { isoCode: true, euVatZone: true } },
        salesChannel: { select: { name: true, nativeCountry: { select: { isoCode: true } } } },
        items: { where: { deletedAt: null }, select: { vatAmount: true, salesTaxAmount: true } } },
    }));
  }
  console.log(`  flagged as channel-collected, Amazon says SELLER: ${rows.length}\n`);
  for (const t of rows) {
    const f = facts[t.transactionRef];
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    console.log(`    ${t.transactionRef}  ${String(t.salesChannel?.name).padEnd(12)} home=${t.salesChannel?.nativeCountry?.isoCode}`
      + ` -> ${t.destinationCountry?.isoCode} (euZone=${t.destinationCountry?.euVatZone})  regime=${t.taxType}`
      + `  ourVat ${vat.toFixed(2)}  channelTax ${tax.toFixed(2)}  amazonScheme=${f.scheme}  amazonVat ${(f.vat + f.shipVat).toFixed(2)}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
