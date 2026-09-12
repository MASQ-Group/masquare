/**
 * eBay orders the marketplace collected on, that nothing has flagged.
 *
 *   REPORT=ebay-flag-gap bash scripts/prod-scan.sh
 *
 * eBay records what it collected in `salesTaxAmount` — its mapping has always put
 * `ebayCollectAndRemitTaxes` there and declined to extract the VAT, which is why eBay's money was
 * right all along. But the per-line `channelReportedTaxCollection` flag only exists on orders
 * imported since it was added, and the VAT-flag repair covers Amazon and OnBuy only.
 *
 * So eBay's amounts are correct and its flag is missing. Writes nothing.
 */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const txs = await p.salesTransaction.findMany({
    where: { deletedAt: null, source: 'ebay' },
    select: {
      transactionRef: true, date: true, vatCollectedByChannel: true, destinationVatPct: true, taxType: true,
      destinationCountry: { select: { isoCode: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, salesTaxAmount: true } },
    },
  });
  let collectedGb = 0, flagged = 0, unflagged = 0, vatOnUnflagged = 0;
  const rateWrong = [];
  const byMonth = {};
  for (const t of txs) {
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const gb = (t.destinationCountry?.isoCode ?? '') === 'GB';
    if (!(tax > 0 && gb && (t.taxType ?? 'vat') === 'vat')) continue;
    collectedGb += 1;
    if (t.vatCollectedByChannel) { flagged += 1; continue; }
    unflagged += 1;
    vatOnUnflagged += vat;
    byMonth[t.date.toISOString().slice(0, 7)] = (byMonth[t.date.toISOString().slice(0, 7)] ?? 0) + 1;
    if ((t.destinationVatPct ?? 0) !== 0 && rateWrong.length < 6) {
      rateWrong.push(`${t.transactionRef}  rate ${t.destinationVatPct}%  our vat ${vat.toFixed(2)}  ebay took ${tax.toFixed(2)}`);
    }
  }
  console.log(`  eBay orders, UK destination, eBay collected   ${collectedGb}`);
  console.log(`    flagged as collected                        ${flagged}`);
  console.log(`    NOT flagged                                 ${unflagged}`);
  console.log(`    VAT we wrongly record on the unflagged      ${vatOnUnflagged.toFixed(2)}   <- money already correct if 0\n`);
  if (rateWrong.length) { console.log('  unflagged, and the stored rate still says we charge VAT:'); for (const l of rateWrong) console.log(`    ${l}`); }
  console.log('\n  unflagged by month:');
  for (const [k, v] of Object.entries(byMonth).sort()) console.log(`    ${String(v).padStart(5)}  ${k}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
