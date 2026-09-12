/**
 * Everything stored about one order, plus what the channel's own report says about it.
 *
 *   REF=114-3886483-9295419 FACTS=<vat2026.json> REPORT=order-forensics bash scripts/prod-scan.sh
 *
 * For the orders a repair refuses. A refusal means the figures disagree in a way no rule should
 * settle on its own, so the next step is to look at everything and decide — which needs everything
 * in one place. Reads only.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { marketplaceRemitsTax } = require('./.compiled/tax-collection.cjs');

const REF = process.env.REF;
if (!REF) { console.error('Set REF to a transaction reference.'); process.exit(1); }
const m = (x) => (x == null ? '—' : Number(x).toFixed(2));

(async () => {
  const p = new PrismaClient();
  const t = await p.salesTransaction.findFirst({
    where: { transactionRef: REF, deletedAt: null },
    include: {
      destinationCountry: true,
      salesChannel: { include: { nativeCountry: true } },
      company: { select: { officialName: true } },
      items: { where: { deletedAt: null } },
    },
  });
  if (!t) { console.log(`  ${REF} is not in the database.`); await p.$disconnect(); return; }

  console.log(`\n  ${REF}`);
  console.log(`    date           ${t.date.toISOString().slice(0, 10)}`);
  console.log(`    company        ${t.company?.officialName}`);
  console.log(`    channel        ${t.salesChannel?.name} (home ${t.salesChannel?.nativeCountry?.isoCode})`);
  console.log(`    destination    ${t.destinationCountry?.isoCode} — ${t.destinationCountry?.name}`);
  console.log(`    regime         ${t.taxType}     collected-by-channel flag: ${t.vatCollectedByChannel}`);
  console.log(`    rate stored    ${t.destinationVatPct}%   overridden: ${t.vatOverridden}`);
  console.log(`    currency       ${t.currency}   fx ${t.exchangeRate}`);
  console.log(`    status         ${t.status}   fulfilment ${t.fulfilmentType ?? '—'}   resolution ${t.resolution ?? '—'}`);
  console.log(`    source         ${t.source}   refund ${m(t.refundAmount)}`);
  console.log(`    written        ${t.createdAt.toISOString()}`);
  console.log(`    last touched   ${t.updatedAt.toISOString()}`);
  console.log(`    rule says the marketplace remits: ${marketplaceRemitsTax(t)}`);

  console.log(`\n    lines`);
  for (const i of t.items) {
    console.log(`      sku ${String(i.channelSku ?? i.sku ?? '?').padEnd(18)} qty ${i.quantity}`);
    console.log(`        net ${m(i.netSalesAmount)}   vat ${m(i.vatAmount)}   shipping ${m(i.shippingAmount)}`
      + `   shipVat ${m(i.shippingAmountVat)}   salesTax(reported) ${m(i.salesTaxAmount)}`);
  }

  if (process.env.FACTS) {
    const facts = JSON.parse(fs.readFileSync(process.env.FACTS, 'utf8'));
    for (const [sheet, rows] of Object.entries(facts)) {
      if (rows && typeof rows === 'object' && rows[REF]) {
        console.log(`\n    the channel's own report (${sheet})`);
        for (const [k, v] of Object.entries(rows[REF])) console.log(`      ${String(k).padEnd(14)} ${v}`);
      }
    }
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
