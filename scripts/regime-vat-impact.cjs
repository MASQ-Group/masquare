/**
 * What zeroing channel-collected tax would move, by regime.
 *
 *   REPORT=regime-vat-impact bash scripts/prod-scan.sh
 *
 * Japan is the reason this is measured rather than assumed: Amazon collects the consumption tax but
 * the SELLER keeps it, so zeroing JCT would cut real revenue. `marketplaceRemitsTax` protects it by
 * construction; this says how much is riding on that being right.
 */
const { PrismaClient } = require('@prisma/client');
const { marketplaceRemitsTax } = require('../apps/api/dist/src/integrations/mappings/tax-collection');
(async () => {
  const p = new PrismaClient();
  const txs = await p.salesTransaction.findMany({
    where: { deletedAt: null, salesChannelId: { not: null } },
    select: {
      taxType: true, vatCollectedByChannel: true,
      salesChannel: { select: { name: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, shippingAmountVat: true } },
    },
  });
  const agg = {};
  for (const t of txs) {
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
    if (vat === 0) continue;
    const regime = t.taxType ?? 'vat';
    const zeroed = marketplaceRemitsTax({ taxType: regime, vatCollectedByChannel: t.vatCollectedByChannel });
    const k = `${regime.padEnd(10)} ${zeroed ? 'WOULD BE ZEROED' : 'kept'}`;
    agg[k] = agg[k] ?? { n: 0, vat: 0, chans: new Set() };
    agg[k].n += 1; agg[k].vat += vat; agg[k].chans.add(t.salesChannel?.name ?? '—');
  }
  console.log('  regime     effect            orders        VAT   channels');
  for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].vat - a[1].vat)) {
    console.log(`  ${k.padEnd(28)} ${String(v.n).padStart(6)} ${v.vat.toFixed(2).padStart(11)}   ${[...v.chans].slice(0, 5).join(', ')}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
