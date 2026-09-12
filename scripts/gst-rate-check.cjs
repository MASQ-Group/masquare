const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  for (const iso of ['AU', 'SG']) {
    const c = await p.country.findFirst({ where: { isoCode: iso, deletedAt: null }, select: { name: true, vatRate: true, euVatZone: true } });
    const txs = await p.salesTransaction.findMany({
      where: { deletedAt: null, destinationCountry: { isoCode: iso } },
      select: { taxType: true, destinationVatPct: true, vatCollectedByChannel: true,
        items: { where: { deletedAt: null }, select: { vatAmount: true, salesTaxAmount: true } } },
    });
    const rates = {}; let vat = 0, tax = 0;
    for (const t of txs) {
      rates[`${t.taxType}@${t.destinationVatPct ?? '—'}%`] = (rates[`${t.taxType}@${t.destinationVatPct ?? '—'}%`] ?? 0) + 1;
      vat += t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
      tax += t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    }
    console.log(`  ${iso} (${c?.name})  countryRate=${c?.vatRate}%  euZone=${c?.euVatZone}  orders=${txs.length}`);
    console.log(`     our vat ${vat.toFixed(2)}   channel tax ${tax.toFixed(2)}`);
    console.log(`     ${Object.entries(rates).map(([k, v]) => `${k} x${v}`).join('  ')}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
