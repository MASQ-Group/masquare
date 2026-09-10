/**
 * Amazon UK orders under the threshold that carry no VAT at all.
 *
 *   node scripts/zero-vat-orders.cjs
 *   ORDER_REF=203-0278685-6690707 node scripts/zero-vat-orders.cjs
 *
 * Below £135 Amazon collects the VAT and remits it, so a £59 order should carry roughly £11.80 —
 * both as the order's own VAT and as the collected figure. A zero is therefore either a legitimate
 * exemption or a gap in what was recorded, and those want opposite responses.
 *
 * I previously counted "its own VAT is zero too" as CONSISTENT and moved on. That was too generous:
 * two zeros agree with each other without either being right. This looks for what the zero-VAT
 * orders have in common — destination, fulfilment, date — because a pattern points at a cause and a
 * scatter points at Amazon's feed.
 *
 * Writes nothing.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');

const ref = process.env.ORDER_REF || null;
const line = (l, v) => console.log(`  ${String(l).padEnd(44)}${v}`);

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  const select = {
    transactionRef: true, date: true, status: true, resolution: true, currency: true,
    destinationVatPct: true, vatOverridden: true, taxType: true, fulfilmentType: true,
    fulfilmentStatus: true, channelShipmentStatus: true, source: true, createdAt: true,
    salesChannel: { select: { name: true, vatThresholdEnabled: true, vatThresholdAmount: true, vatBelowThresholdPct: true, company: { select: { officialName: true } } } },
    destinationCountry: { select: { name: true, isoCode: true, vatRate: true } },
    items: { where: { deletedAt: null }, select: { sku: true, quantity: true, netSalesAmount: true, vatAmount: true, salesTaxAmount: true, vatRatePct: true } },
  };

  if (ref) {
    const t = await prisma.salesTransaction.findFirst({ where: { transactionRef: ref, deletedAt: null }, select });
    if (!t) { console.log(`No live order ${ref}.`); await app.close(); return; }
    console.log(`ORDER ${t.transactionRef}\n`);
    line('date', t.date.toISOString().slice(0, 10));
    line('pulled into the platform', t.createdAt.toISOString().slice(0, 16));
    line('source', t.source ?? '—');
    line('channel', `${t.salesChannel?.name ?? '—'} · ${t.salesChannel?.company?.officialName ?? '—'}`);
    line('channel threshold rule', t.salesChannel?.vatThresholdEnabled
      ? `${t.salesChannel.vatThresholdAmount} · below ${t.salesChannel.vatBelowThresholdPct}%` : 'OFF');
    line('DESTINATION', `${t.destinationCountry?.name ?? '— none set —'} (${t.destinationCountry?.isoCode ?? '?'}) country rate ${t.destinationCountry?.vatRate ?? '—'}%`);
    line('destinationVatPct stored', `${t.destinationVatPct ?? '—'}${t.vatOverridden ? ' (overridden by hand)' : ''}`);
    line('tax type', t.taxType ?? '—');
    line('fulfilment', `${t.fulfilmentType ?? '—'} · ${t.fulfilmentStatus} · channel ${t.channelShipmentStatus ?? '—'}`);
    console.log('\n  lines:');
    for (const i of t.items) {
      console.log(`    ${(i.sku ?? '').padEnd(24)} qty ${i.quantity}  net ${Number(i.netSalesAmount ?? 0).toFixed(2)}  `
        + `vat ${Number(i.vatAmount ?? 0).toFixed(2)} @ ${i.vatRatePct ?? '—'}%  collected ${Number(i.salesTaxAmount ?? 0).toFixed(2)}`);
    }
    await app.close();
    return;
  }

  const channels = await prisma.salesChannel.findMany({
    where: { deletedAt: null, name: { equals: 'Amazon UK', mode: 'insensitive' } }, select: { id: true },
  });
  const txs = await prisma.salesTransaction.findMany({
    where: { salesChannelId: { in: channels.map((c) => c.id) }, deletedAt: null },
    select, orderBy: { date: 'desc' }, take: 4000,
  });

  const zero = txs.filter((t) => {
    const net = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    return net > 0 && net <= 135 && vat === 0;
  });

  console.log(`  Amazon UK orders examined                   ${txs.length}`);
  console.log(`  below threshold, non-zero net, NO VAT       ${zero.length}\n`);

  const tally = (label, fn) => {
    const by = {};
    for (const t of zero) { const k = String(fn(t) ?? '—'); by[k] = (by[k] ?? 0) + 1; }
    console.log(`  by ${label}:`);
    for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`    ${String(n).padStart(5)}  ${k}`);
    }
    console.log('');
  };

  tally('destination country', (t) => (t.destinationCountry ? `${t.destinationCountry.name} (${t.destinationCountry.isoCode}) rate ${t.destinationCountry.vatRate}%` : 'NO DESTINATION SET'));
  tally('stored destinationVatPct', (t) => t.destinationVatPct);
  tally('month pulled in', (t) => t.createdAt.toISOString().slice(0, 7));
  tally('fulfilment type', (t) => t.fulfilmentType);
  tally('channel shipment status', (t) => t.channelShipmentStatus);
  tally('fulfilment status', (t) => t.fulfilmentStatus);
  tally('line vatRatePct', (t) => t.items[0]?.vatRatePct);

  /**
   * The export cases are not a fault and must not be counted with the rest.
   *
   * Goods leaving the UK are zero-rated, so no VAT is due and none is collected. Grouping them with
   * the GB orders would inflate the problem with orders that are already correct.
   */
  const gb = zero.filter((t) => t.destinationCountry?.isoCode === 'GB');
  const exports_ = zero.filter((t) => t.destinationCountry?.isoCode !== 'GB');
  console.log(`  shipped INSIDE the UK — VAT was due       ${gb.length}`);
  console.log(`  shipped outside the UK — zero-rated       ${exports_.length}`);
  console.log('');
  const byMonth = {};
  for (const t of gb) { const k = t.date.toISOString().slice(0, 7); byMonth[k] = (byMonth[k] ?? 0) + 1; }
  console.log('  the GB ones, by order month:');
  for (const [k, n] of Object.entries(byMonth).sort()) console.log(`    ${k}  ${String(n).padStart(4)}`);
  console.log('');
  console.log('  a few of them:');
  for (const t of zero.slice(0, 10)) {
    const net = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0), 0);
    console.log(`    ${t.transactionRef}  ${t.date.toISOString().slice(0, 10)}  net ${net.toFixed(2)}  `
      + `dest ${t.destinationCountry?.isoCode ?? '—'}  storedVat ${t.destinationVatPct ?? '—'}`);
  }

  await app.close();
})().catch(async (e) => { console.error(e?.message ?? e); process.exit(1); });
