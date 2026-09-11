/**
 * What the channel-collected-tax repair would remove, read-only, against production.
 *
 *   REPORT=collected-tax-repair-preview bash scripts/prod-scan.sh
 *
 * Mirrors `repairChannelCollectedTax`'s selection and shares its rule — `marketplaceRemitsTax` — so
 * the two cannot answer differently. The repair itself is admin-only and writes; this only looks.
 */
const { PrismaClient } = require('@prisma/client');
const { marketplaceRemitsTax } = require('../apps/api/dist/src/integrations/mappings/tax-collection');

(async () => {
  const p = new PrismaClient();
  const txs = await p.salesTransaction.findMany({
    where: { deletedAt: null, salesChannelId: { not: null }, vatOverridden: false },
    select: {
      date: true, taxType: true, vatCollectedByChannel: true, transactionRef: true,
      salesChannel: { select: { name: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, shippingAmountVat: true, salesTaxAmount: true } },
    },
  });

  let orders = 0, lines = 0, tax = 0, refused = 0;
  const byChannel = {}, byMonth = {}, byRegime = {};
  const refusedEx = [];
  for (const t of txs) {
    if (!marketplaceRemitsTax({ taxType: t.taxType, vatCollectedByChannel: t.vatCollectedByChannel })) continue;
    const carrying = t.items.filter((i) => (i.vatAmount ?? 0) !== 0 || (i.shippingAmountVat ?? 0) !== 0);
    if (!carrying.length) continue;
    if (carrying.some((i) => (i.salesTaxAmount ?? 0) === 0)) {
      refused += 1; if (refusedEx.length < 6) refusedEx.push(t.transactionRef); continue;
    }
    const amt = carrying.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
    orders += 1; lines += carrying.length; tax += amt;
    const c = t.salesChannel?.name ?? '—';
    byChannel[c] = { orders: (byChannel[c]?.orders ?? 0) + 1, tax: (byChannel[c]?.tax ?? 0) + amt };
    byMonth[t.date.toISOString().slice(0, 7)] = (byMonth[t.date.toISOString().slice(0, 7)] ?? 0) + amt;
    const r = t.taxType ?? 'vat';
    byRegime[r] = { orders: (byRegime[r]?.orders ?? 0) + 1, tax: (byRegime[r]?.tax ?? 0) + amt };
  }

  console.log(`  orders that would change        ${orders}`);
  console.log(`  lines                           ${lines}`);
  console.log(`  tax removed (mixed currencies)  ${tax.toFixed(2)}`);
  console.log(`  refused — nothing to fall back on ${refused}${refusedEx.length ? '  e.g. ' + refusedEx.join(', ') : ''}\n`);
  console.log('  by regime:');
  for (const [k, v] of Object.entries(byRegime).sort((a, b) => b[1].tax - a[1].tax)) console.log(`    ${v.tax.toFixed(2).padStart(12)}  ${String(v.orders).padStart(5)} orders  ${k}`);
  console.log('\n  by channel:');
  for (const [k, v] of Object.entries(byChannel).sort((a, b) => b[1].tax - a[1].tax)) console.log(`    ${v.tax.toFixed(2).padStart(12)}  ${String(v.orders).padStart(5)} orders  ${k}`);
  console.log('\n  by month:');
  for (const [k, v] of Object.entries(byMonth).sort()) console.log(`    ${v.toFixed(2).padStart(12)}  ${k}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
