/**
 * How much VAT we record as ours on orders the marketplace actually collected.
 *
 *   REPORT=marketplace-vat-overstated bash scripts/prod-scan.sh
 *
 * Amazon's VAT Transactions Report puts the seller's VAT at ZERO on every UK_VOEC-IMPORT order — the
 * marketplace is the deemed supplier and charges the buyer itself. The order API still reports that
 * tax on the line, we store it as `vatAmount`, and it lands in `sellerBaseNative` — which is what
 * `revenueIncVatEur` and the margin percentage are built from.
 *
 * So this is money in the revenue figures that never reached us. Writes nothing.
 */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const txs = await p.salesTransaction.findMany({
    where: { deletedAt: null, vatCollectedByChannel: true },
    select: {
      date: true, taxType: true,
      salesChannel: { select: { name: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, shippingAmountVat: true, netSalesAmount: true } },
    },
  });
  let vat = 0, net = 0;
  const byChannel = {}, byMonth = {};
  for (const t of txs) {
    const v = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
    const n = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    vat += v; net += n;
    const c = t.salesChannel?.name ?? '—';
    byChannel[c] = (byChannel[c] ?? 0) + v;
    const mth = t.date.toISOString().slice(0, 7);
    byMonth[mth] = (byMonth[mth] ?? 0) + v;
  }
  console.log(`  orders flagged as collected by the channel   ${txs.length}`);
  console.log(`  their net sales (native currency, summed)    ${net.toFixed(2)}`);
  console.log(`  VAT we record on them — none of it ours      ${vat.toFixed(2)}\n`);
  console.log('  by channel:');
  for (const [k, v2] of Object.entries(byChannel).sort((a, b) => b[1] - a[1])) console.log(`    ${v2.toFixed(2).padStart(12)}  ${k}`);
  console.log('\n  by month:');
  for (const [k, v2] of Object.entries(byMonth).sort()) console.log(`    ${v2.toFixed(2).padStart(12)}  ${k}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
