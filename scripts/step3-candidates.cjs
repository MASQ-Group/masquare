/**
 * Exactly what step 3 would clear right now, order by order — no facts file, no date window.
 *
 *   REPORT=step3-candidates bash scripts/prod-scan.sh
 *
 * For when a dry run returns a different count than a windowed comparison predicted. The comparison
 * can only see the orders in its spreadsheet; this sees the database.
 *
 * Decided by the shipped `marketplaceRemitsTax`, compiled by the wrapper. Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const { marketplaceRemitsTax } = require('./.compiled/tax-collection.cjs');

(async () => {
  const p = new PrismaClient();
  const rows = await p.salesTransaction.findMany({
    where: {
      deletedAt: null,
      items: { some: { deletedAt: null, OR: [{ vatAmount: { gt: 0 } }, { shippingAmountVat: { gt: 0 } }] } },
    },
    select: {
      transactionRef: true, date: true, taxType: true, vatCollectedByChannel: true, currency: true,
      destinationVatPct: true,
      destinationCountry: { select: { isoCode: true, name: true } },
      salesChannel: { select: { name: true, nativeCountry: { select: { isoCode: true } } } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, shippingAmountVat: true, salesTaxAmount: true } },
    },
    orderBy: { date: 'asc' },
  });

  const clear = [], refuse = [];
  for (const t of rows) {
    if (!marketplaceRemitsTax(t)) continue;
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
    const reported = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    (reported === 0 ? refuse : clear).push({ t, vat, reported });
  }

  const show = (label, list) => {
    console.log(`\n  ${label} — ${list.length} order(s), ${list.reduce((s, r) => s + r.vat, 0).toFixed(2)} (mixed currencies)`);
    for (const { t, vat, reported } of list) {
      console.log(`    ${t.date.toISOString().slice(0, 10)}  ${t.transactionRef}  ${String(t.salesChannel?.name ?? '?').padEnd(12)}`
        + ` -> ${t.destinationCountry?.isoCode} (${t.destinationCountry?.name})  regime=${t.taxType} flag=${t.vatCollectedByChannel}`
        + ` rate=${t.destinationVatPct}  ours ${vat.toFixed(2)} ${t.currency}  channel reported ${reported.toFixed(2)}`);
    }
  };
  show('step 3 would clear', clear);
  show('step 3 would refuse (no reported total behind the figure)', refuse);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
