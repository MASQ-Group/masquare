/** OnBuy UK orders by (threshold, VAT present) — is the threshold or the reported tax the signal? */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const txs = await p.salesTransaction.findMany({
    where: { deletedAt: null, source: 'onbuy', destinationCountry: { isoCode: 'GB' } },
    select: {
      transactionRef: true, vatCollectedByChannel: true,
      salesChannel: { select: { vatThresholdAmount: true } },
      items: { where: { deletedAt: null }, select: { netSalesAmount: true, vatAmount: true } },
    },
  });
  const box = { 'under+vat': 0, 'under+noVat': 0, 'over+vat': 0, 'over+noVat': 0 };
  const overWithVat = [];
  for (const t of txs) {
    const net = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const under = net <= Number(t.salesChannel?.vatThresholdAmount ?? 135);
    const k = `${under ? 'under' : 'over'}+${vat > 0 ? 'vat' : 'noVat'}`;
    box[k] += 1;
    if (!under && vat > 0 && overWithVat.length < 10) overWithVat.push(`${t.transactionRef}  net ${net.toFixed(2)}  vat ${vat.toFixed(2)}`);
  }
  console.log(`  OnBuy UK orders                         ${txs.length}\n`);
  console.log(`  under threshold, VAT reported           ${box['under+vat']}   <- the 68 flipped`);
  console.log(`  under threshold, NO VAT reported        ${box['under+noVat']}   <- left alone by the guard`);
  console.log(`  OVER threshold, VAT reported            ${box['over+vat']}   <- the question`);
  console.log(`  over threshold, no VAT reported         ${box['over+noVat']}`);
  if (overWithVat.length) { console.log('\n  over threshold WITH VAT reported:'); for (const s of overWithVat) console.log('    ' + s); }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
