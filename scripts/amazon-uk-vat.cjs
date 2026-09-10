/**
 * Is marketplace-collected VAT actually recorded on Amazon UK orders under the threshold?
 *
 *   node scripts/amazon-uk-vat.cjs
 *
 * Below £135 intrinsic value Amazon collects the VAT from the buyer and remits it itself. The seller
 * never receives it, so it is neutral to profit — but it still has to appear on a VAT return, which
 * is why it is worth showing and storing.
 *
 * The platform already has a column for it (`salesTaxAmount`, "reporting only"). Whether Amazon's
 * feed actually fills it is a different question, and a display gated on `> 0` shows nothing at all
 * if it does not. This answers that before anything is built on top of it. Writes nothing.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');

const line = (l, v) => console.log(`  ${l.padEnd(50)}${v}`);

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  /**
   * Live channels only, and named with their owner.
   *
   * The first version matched `contains: 'UK'` and ignored `deletedAt`, so it swept in eBay UK,
   * OnBuy UK, a test channel and several soft-deleted rows — then presented the mixture as five
   * Amazon UK channels disagreeing about the threshold. There is no disagreement: two companies
   * each hold their own Amazon UK, which is how channels work here, and both carry the same rule.
   * A report that cannot tell a per-company channel from a duplicate manufactures alarm.
   */
  const channels = await prisma.salesChannel.findMany({
    where: { deletedAt: null, name: { contains: 'UK', mode: 'insensitive' } },
    select: {
      id: true, name: true, nativeCurrency: true,
      vatThresholdEnabled: true, vatThresholdAmount: true,
      vatBelowThresholdPct: true, vatAboveThresholdPct: true,
      company: { select: { officialName: true } },
    },
  });
  console.log('Live UK sales channels and their threshold rule:\n');
  for (const c of channels) {
    console.log(`  ${(c.name + ' · ' + (c.company?.officialName ?? 'no company')).padEnd(52)}`
      + `threshold=${c.vatThresholdEnabled ? c.vatThresholdAmount : 'off'} `
      + `below=${c.vatBelowThresholdPct ?? '—'}% above=${c.vatAboveThresholdPct ?? '—'}%`);
  }

  const amazonUk = channels.filter((c) => /amazon/i.test(c.name));
  if (!amazonUk.length) { console.log('\n  No Amazon UK channel found by name.'); await app.close(); return; }

  const ids = amazonUk.map((c) => c.id);
  const txs = await prisma.salesTransaction.findMany({
    where: { salesChannelId: { in: ids }, deletedAt: null },
    select: {
      transactionRef: true, date: true, currency: true, destinationVatPct: true,
      items: { where: { deletedAt: null }, select: { netSalesAmount: true, vatAmount: true, salesTaxAmount: true } },
    },
    orderBy: { date: 'desc' },
    take: 4000,
  });

  console.log(`\n  Amazon UK orders examined                         ${txs.length}`);

  let below = 0, belowWithTax = 0, above = 0, aboveWithTax = 0;
  const samples = [];
  for (const t of txs) {
    // Intrinsic value: net of the goods, ex-VAT and ex-shipping, as HMRC defines the consignment.
    const intrinsic = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    const isBelow = intrinsic <= 135;
    if (isBelow) { below += 1; if (tax > 0) belowWithTax += 1; }
    else { above += 1; if (tax > 0) aboveWithTax += 1; }
    if (isBelow && samples.length < 8) {
      samples.push(`${t.transactionRef}  ${t.date.toISOString().slice(0, 10)}  net ${intrinsic.toFixed(2)}  vat ${t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0).toFixed(2)}  collected ${tax.toFixed(2)}`);
    }
  }

  line('under the 135 threshold', below);
  line('  of those, carrying a collected-tax figure', belowWithTax);
  line('at or over the threshold', above);
  line('  of those, carrying a collected-tax figure', aboveWithTax);

  /**
   * Why a below-threshold order carries nothing, which is usually not a fault.
   *
   * If its own VAT is also zero the two agree: the order was zero-rated, exempt, or cancelled
   * down to nothing, and there was no VAT for anyone to collect. Only an order WITH VAT and no
   * collected figure is a real gap, so the two are counted apart rather than summed into one
   * alarming number.
   */
  let consistent = 0, realGap = 0;
  for (const t of txs) {
    const intrinsic = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    if (intrinsic > 135) continue;
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    if (tax > 0) continue;
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    if (vat === 0) consistent += 1; else realGap += 1;
  }
  console.log('');
  line('below-threshold orders with no collected figure', below - belowWithTax);
  line('  their own VAT is zero too — consistent', consistent);
  line('  they DO carry VAT — a real gap', realGap);

  console.log('\n  A few below-threshold orders:');
  for (const s of samples) console.log(`    ${s}`);

  if (below > 0 && belowWithTax === 0) {
    console.log('\n  Nothing below the threshold carries a collected-tax figure. A display gated on');
    console.log('  "greater than zero" would therefore show nothing, and the number would have to be');
    console.log('  derived from the VAT rate rather than read from Amazon.');
  }

  await app.close();
})().catch(async (e) => { console.error(e?.message ?? e); process.exit(1); });
