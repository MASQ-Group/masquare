/**
 * Orders whose stored tax regime disagrees with their destination.
 *
 *   REPORT=stale-tax-regime bash scripts/prod-scan.sh
 *
 * `taxType` is snapshotted when an order is saved, and `recalculate` does NOT re-derive it — its
 * update writes currency, FX, shipping service, the VAT rate and the override flag, and nothing
 * else. So an order saved before `taxRegimeFor` learned a case keeps the answer it was given.
 *
 * It matters because the regime decides how the tax reads: `marketplaceRemitsTax` calls GST and US
 * sales tax the channel's, Japanese consumption tax ours, and VAT ours unless the channel said
 * otherwise. A Swiss sale stored as 'vat' with no collected flag therefore reads as our liability
 * for tax eBay actually took.
 *
 * Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const { taxRegimeFor } = require('../apps/api/dist/src/sales-transactions/vat-scope');
(async () => {
  const p = new PrismaClient();
  const txs = await p.salesTransaction.findMany({
    where: { deletedAt: null, destinationCountryId: { not: null } },
    select: {
      transactionRef: true, taxType: true, vatCollectedByChannel: true,
      destinationCountry: { select: { isoCode: true, euVatZone: true, name: true } },
      salesChannel: { select: { name: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, salesTaxAmount: true } },
    },
  });
  let wrong = 0;
  const byMove = {}, samples = [];
  let taxAtRisk = 0;
  for (const t of txs) {
    const want = taxRegimeFor(t.destinationCountry);
    const have = t.taxType ?? 'vat';
    if (want === have) continue;
    wrong += 1;
    const k = `${have} -> ${want}`;
    byMove[k] = (byMove[k] ?? 0) + 1;
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const ch = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    if (vat > 0) taxAtRisk += vat;
    if (samples.length < 10) {
      samples.push(`${t.transactionRef.padEnd(18)} ${String(t.salesChannel?.name).padEnd(12)} -> ${t.destinationCountry?.isoCode}`
        + `  stored ${have.padEnd(10)} should be ${want.padEnd(10)} our vat ${vat.toFixed(2)}  channel took ${ch.toFixed(2)}`);
    }
  }
  console.log(`  orders examined                         ${txs.length}`);
  console.log(`  stored regime disagrees with destination ${wrong}`);
  console.log(`  of those, carrying VAT we call ours      ${taxAtRisk.toFixed(2)}\n`);
  console.log('  by change:');
  for (const [k, n] of Object.entries(byMove).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${k}`);
  console.log('\n  a few:');
  for (const s of samples) console.log(`    ${s}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
