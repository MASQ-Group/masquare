/**
 * The one place a tax classification moves PROFIT, not just revenue.
 *
 *   REPORT=jct-classification-check bash scripts/prod-scan.sh
 *
 * `revNativeOf` is net + shipping, plus the tax ONLY when the regime is 'jct' — Japan is the one
 * market where the seller keeps the consumption tax, so there it is revenue. Everywhere else the tax
 * is excluded, which is why channel-collected tax never reached profit.
 *
 * That makes taxType 'jct' the single classification that can move a profit figure. Wrong in one
 * direction it understates a Japanese sale; wrong in the other it inflates a non-Japanese one.
 */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const txs = await p.salesTransaction.findMany({
    where: { deletedAt: null, OR: [{ taxType: 'jct' }, { destinationCountry: { isoCode: 'JP' } }] },
    select: {
      transactionRef: true, taxType: true,
      destinationCountry: { select: { isoCode: true } },
      salesChannel: { select: { name: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, shippingAmountVat: true } },
    },
  });
  let bothAgree = 0;
  const jpNotJct = [], jctNotJp = [];
  let riskUnder = 0, riskOver = 0;
  for (const t of txs) {
    const iso = t.destinationCountry?.isoCode ?? '';
    const tax = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
    const isJp = iso === 'JP';
    const isJct = (t.taxType ?? '') === 'jct';
    if (isJp && isJct) { bothAgree += 1; continue; }
    if (isJp && !isJct) { riskUnder += tax; if (jpNotJct.length < 8) jpNotJct.push(`${t.transactionRef}  ${t.salesChannel?.name}  taxType=${t.taxType ?? 'null'}  tax ${tax.toFixed(2)}`); }
    if (!isJp && isJct) { riskOver += tax; if (jctNotJp.length < 8) jctNotJp.push(`${t.transactionRef}  ${t.salesChannel?.name} -> ${iso || '—'}  tax ${tax.toFixed(2)}`); }
  }
  console.log(`  Japan-destined AND classified jct — agree      ${bothAgree}`);
  console.log(`  Japan-destined but NOT jct (profit understated) ${jpNotJct.length ? '' : '0'}${jpNotJct.length ? jpNotJct.length + '  tax ' + riskUnder.toFixed(2) : ''}`);
  console.log(`  classified jct but NOT Japan (profit inflated)  ${jctNotJp.length ? jctNotJp.length + '  tax ' + riskOver.toFixed(2) : '0'}`);
  for (const l of jpNotJct) console.log('    ' + l);
  for (const l of jctNotJp) console.log('    ' + l);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
