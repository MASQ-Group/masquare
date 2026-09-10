/**
 * How many existing orders carry a VAT rate the corrected scope rules would not have produced.
 *
 *   node scripts/vat-scope-impact.cjs
 *
 * Two rules were applied too widely:
 *
 *   the channel's consignment threshold fired on VALUE alone, so a £59 parcel to Israel was rated at
 *   the UK's 20% — a threshold belongs to the country the goods enter;
 *
 *   every destination outside the VAT area was called a 'vat' sale, which made a zero-rated export
 *   indistinguishable from a domestic sale whose VAT had gone unrecorded.
 *
 * Both are fixed forward. This counts what the old rules already wrote, because a fix that only
 * applies to new orders leaves the old ones stating a rate nobody would defend. Writes nothing.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');
const { taxRegimeFor } = require('../apps/api/dist/src/sales-transactions/vat-scope');

const line = (l, v) => console.log(`  ${String(l).padEnd(52)}${v}`);

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  const txs = await prisma.salesTransaction.findMany({
    where: { deletedAt: null, salesChannelId: { not: null } },
    select: {
      transactionRef: true, date: true, destinationVatPct: true, taxType: true, vatOverridden: true,
      destinationCountry: { select: { isoCode: true, euVatZone: true, name: true } },
      salesChannel: { select: { name: true, nativeCountry: { select: { isoCode: true } } } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, netSalesAmount: true } },
    },
    take: 20000,
  });

  let ratedExports = 0;
  let regimeChanges = 0;
  const byCountry = {};
  const samples = [];

  for (const t of txs) {
    const dest = (t.destinationCountry?.isoCode ?? '').toUpperCase();
    const home = (t.salesChannel?.nativeCountry?.isoCode ?? '').toUpperCase();
    const wanted = taxRegimeFor(t.destinationCountry);
    if ((t.taxType ?? 'vat') !== wanted) regimeChanges += 1;

    /**
     * The mis-scoped threshold leaves its fingerprint: a rate above zero on a sale that left the
     * channel's own jurisdiction. Overridden rows are excluded — somebody chose those deliberately
     * and a rule change must not second-guess a person.
     */
    if (!t.vatOverridden && dest && home && dest !== home && (t.destinationVatPct ?? 0) > 0 && wanted === 'none') {
      ratedExports += 1;
      const k = `${t.destinationCountry?.name} (${dest})`;
      byCountry[k] = (byCountry[k] ?? 0) + 1;
      if (samples.length < 10) {
        const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
        const net = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
        samples.push(`${t.transactionRef}  ${t.date.toISOString().slice(0, 10)}  ${t.salesChannel?.name} -> ${dest}  `
          + `net ${net.toFixed(2)}  stored rate ${t.destinationVatPct}%  actual vat ${vat.toFixed(2)}`);
      }
    }
  }

  line('orders examined', txs.length);
  line('stored regime differs from the corrected rule', regimeChanges);
  line('EXPORTS carrying a VAT rate they should not', ratedExports);
  console.log('\n  those exports, by destination:');
  for (const [k, n] of Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(n).padStart(5)}  ${k}`);
  }
  console.log('\n  a few of them:');
  for (const s of samples) console.log(`    ${s}`);

  await app.close();
})().catch(async (e) => { console.error(e?.message ?? e); process.exit(1); });
