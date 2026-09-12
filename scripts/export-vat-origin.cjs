/**
 * VAT recorded as ours on sales to countries where we charge none — and where the figure came from.
 *
 *   REPORT=export-vat-origin bash scripts/prod-scan.sh
 *
 * The regime fix relabels these; it does not remove the money. So the question left standing is
 * whether the figure should be there at all, and that turns on WHERE IT CAME FROM:
 *
 *   vatAmount == salesTaxAmount   the channel reported this tax. Recording it is faithful even if
 *                                 the label was wrong, and removing it would discard what was said.
 *
 *   vatAmount  > 0, salesTax 0    nobody reported it. It was derived — from a rate, or a gross the
 *                                 mapping split on an assumption — and on a zero-rated export there
 *                                 is nothing for it to be derived from.
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
      transactionRef: true, date: true, taxType: true, destinationVatPct: true, vatOverridden: true,
      vatCollectedByChannel: true,
      salesChannel: { select: { name: true, kind: true } },
      destinationCountry: { select: { isoCode: true, euVatZone: true, name: true, vatRate: true } },
      items: { where: { deletedAt: null }, select: { netSalesAmount: true, vatAmount: true, salesTaxAmount: true, shippingAmountVat: true } },
    },
  });

  let reported = 0, derived = 0, reportedSum = 0, derivedSum = 0;
  const byChannel = {}, byCountry = {};
  const derivedSamples = [], reportedSamples = [];

  for (const t of txs) {
    if (taxRegimeFor(t.destinationCountry) !== 'none') continue;     // only genuine exports
    if (t.salesChannel?.kind === 'local') continue;                   // we invoice those ourselves
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    if (vat <= 0) continue;
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    const net = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    /**
     * Amazon's `salesTaxAmount` is ItemTax PLUS ShippingTax; `vatAmount` is ItemTax alone. Comparing
     * the two directly makes every order with postage look derived — which is exactly what it did,
     * and all thirteen "nobody reported these" were the shipping tax and nothing else.
     */
    const shipVat = t.items.reduce((s, i) => s + (i.shippingAmountVat ?? 0), 0);
    const isReported = Math.abs(vat - (tax - shipVat)) <= 0.02 && tax > 0;
    const line = `${t.transactionRef.padEnd(20)} ${String(t.salesChannel?.name).padEnd(13)} -> ${t.destinationCountry?.isoCode}`
      + `  net ${net.toFixed(2).padStart(8)}  vat ${vat.toFixed(2).padStart(7)}  channelTax ${tax.toFixed(2).padStart(7)}`
      + `  effective ${net > 0 ? ((vat / net) * 100).toFixed(1) : '—'}%  flagged=${t.vatCollectedByChannel}`;
    if (isReported) { reported += 1; reportedSum += vat; if (reportedSamples.length < 6) reportedSamples.push(line); }
    else { derived += 1; derivedSum += vat; if (derivedSamples.length < 10) derivedSamples.push(line); }
    const c = t.salesChannel?.name ?? '—';
    byChannel[c] = { n: (byChannel[c]?.n ?? 0) + 1, vat: (byChannel[c]?.vat ?? 0) + vat };
    const k = `${t.destinationCountry?.name} (${t.destinationCountry?.isoCode})`;
    byCountry[k] = { n: (byCountry[k]?.n ?? 0) + 1, vat: (byCountry[k]?.vat ?? 0) + vat };
  }

  console.log(`  export sales carrying VAT we call ours      ${reported + derived}`);
  console.log(`    the channel reported that tax             ${reported}   ${reportedSum.toFixed(2)}`);
  console.log(`    nobody reported it — derived              ${derived}   ${derivedSum.toFixed(2)}\n`);
  console.log('  by channel:');
  for (const [k, v] of Object.entries(byChannel).sort((a, b) => b[1].vat - a[1].vat)) console.log(`    ${v.vat.toFixed(2).padStart(10)}  ${String(v.n).padStart(4)}  ${k}`);
  console.log('\n  by destination:');
  for (const [k, v] of Object.entries(byCountry).sort((a, b) => b[1].vat - a[1].vat).slice(0, 12)) console.log(`    ${v.vat.toFixed(2).padStart(10)}  ${String(v.n).padStart(4)}  ${k}`);
  if (derivedSamples.length) { console.log('\n  DERIVED — nobody reported these:'); for (const l of derivedSamples) console.log(`    ${l}`); }
  if (reportedSamples.length) { console.log('\n  REPORTED — the channel said so:'); for (const l of reportedSamples) console.log(`    ${l}`); }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
