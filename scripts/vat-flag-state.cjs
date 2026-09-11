/** Where the VAT flag currently stands on production, by channel and by whether VAT exists. */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const rows = await p.salesTransaction.findMany({
    where: { deletedAt: null, vatCollectedByChannel: true },
    select: { source: true, salesChannel: { select: { name: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, salesTaxAmount: true } } },
  });
  const byChan = {};
  let noVat = 0;
  for (const t of rows) {
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    const c = t.salesChannel?.name ?? '—';
    byChan[c] = byChan[c] ?? { n: 0, noTaxAtAll: 0 };
    byChan[c].n += 1;
    if (vat === 0 && tax === 0) { byChan[c].noTaxAtAll += 1; noVat += 1; }
  }
  console.log(`  orders flagged as collected by the channel   ${rows.length}`);
  console.log(`    of those, carrying no tax at all           ${noVat}\n`);
  for (const [k, v] of Object.entries(byChan).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${String(v.n).padStart(5)}  ${k}${v.noTaxAtAll ? `   (${v.noTaxAtAll} with no tax)` : ''}`);
  }
  const ukVoecUnflagged = await p.salesTransaction.count({
    where: { deletedAt: null, source: 'amazon', vatCollectedByChannel: false,
      destinationCountry: { isoCode: 'GB' }, salesChannel: { nativeCountry: { isoCode: 'GB' } },
      OR: [{ taxType: null }, { taxType: 'vat' }],
      items: { some: { deletedAt: null, vatAmount: { gt: 0 } } } },
  });
  console.log(`\n  Amazon UK -> GB, VAT on the line, still unflagged: ${ukVoecUnflagged}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
