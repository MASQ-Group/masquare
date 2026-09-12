/**
 * Where Amazon's US sales tax actually landed in our columns.
 *
 *   REPORT=us-tax-shape bash scripts/prod-scan.sh
 *
 * US orders carry no VAT — there is no such tax there. So a figure in `vatAmount` on a US order is
 * a figure in the wrong column, and the question is whether that is one stray import or the normal
 * shape for some cohort of them. Reads only.
 */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const rows = await p.salesTransaction.findMany({
    where: { deletedAt: null, destinationCountry: { isoCode: { in: ['US', 'CA', 'MX'] } } },
    select: {
      transactionRef: true, date: true, createdAt: true, taxType: true, source: true,
      destinationCountry: { select: { isoCode: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, salesTaxAmount: true } },
    },
  });
  const bucket = { 'reported only (correct)': [], 'vat only (wrong column)': [], 'both': [], 'neither': [] };
  for (const t of rows) {
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const rep = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    const k = vat > 0 && rep > 0 ? 'both' : vat > 0 ? 'vat only (wrong column)' : rep > 0 ? 'reported only (correct)' : 'neither';
    bucket[k].push({ t, vat, rep });
  }
  console.log(`\n  ${rows.length} order(s) to the US, Canada and Mexico\n`);
  for (const [k, list] of Object.entries(bucket)) {
    console.log(`    ${k.padEnd(26)} ${String(list.length).padStart(4)}`);
    for (const { t, vat, rep } of list.slice(0, 4)) {
      console.log(`        ${t.date.toISOString().slice(0, 10)}  ${t.transactionRef}  ${t.destinationCountry?.isoCode}`
        + `  vat ${vat.toFixed(2)}  reported ${rep.toFixed(2)}  imported ${t.createdAt.toISOString().slice(0, 10)}  via ${t.source}`);
    }
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
