/**
 * What eBay and OnBuy report, against what we stored — order by order.
 *
 *   FACTS=<channel-facts.json> REPORT=channel-vat-review bash scripts/prod-scan.sh
 *
 * The Amazon review had one clean signal to check against: a VAT report stating the seller's own
 * figure. These two do not report that, so the checks differ:
 *
 *   OnBuy  states its deemed-supplier tax per order. Present means OnBuy collected and nothing is
 *          ours; absent means the consignment was above the threshold and the supply is zero-rated.
 *          Either way OUR VAT is zero, which makes it a strong check.
 *
 *   eBay   states what IT collected and remits, and its tax TYPE. `Seller collected tax` is zero on
 *          every row, so eBay never collects on our behalf — where it collected nothing and the
 *          destination is in the EU, the VAT is ours to charge and eBay has nothing to say about it.
 *          So only the collected side can be checked against the file.
 *
 * Writes nothing.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const FACTS = process.env.FACTS;
if (!FACTS) { console.error('Set FACTS to the extracted channel facts JSON.'); process.exit(1); }
const m = (n) => (n == null ? '—' : Number(n).toFixed(2));

(async () => {
  const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
  const prisma = new PrismaClient();

  const load = async (refs) => {
    const txs = await prisma.salesTransaction.findMany({
      where: { deletedAt: null, transactionRef: { in: refs } },
      select: {
        transactionRef: true, destinationVatPct: true, vatCollectedByChannel: true, taxType: true,
        destinationCountry: { select: { isoCode: true } },
        salesChannel: { select: { name: true } },
        items: {
          where: { deletedAt: null },
          select: { netSalesAmount: true, vatAmount: true, shippingAmountVat: true, salesTaxAmount: true },
        },
      },
    });
    return new Map(txs.map((t) => [t.transactionRef, t]));
  };

  // ── OnBuy ───────────────────────────────────────────────────────────────
  const onbuy = Object.entries(facts.onbuy).filter(([, f]) => !f.blank);
  const ours1 = await load(onbuy.map(([r]) => r));
  let missing = 0, agree = 0;
  const badFlag = [], badVat = [], badTax = [];
  for (const [ref, f] of onbuy) {
    const t = ours1.get(ref);
    if (!t) { missing += 1; continue; }
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    let ok = true;
    if (!!t.vatCollectedByChannel !== f.collectedByChannel) {
      ok = false; badFlag.push(`${ref}  onbuy=${f.collectedByChannel} ours=${!!t.vatCollectedByChannel}  gross ${m(f.gross)}`);
    }
    if (Math.abs(vat - f.ourVat) > 0.02) {
      ok = false; badVat.push(`${ref}  ours ${m(vat)}  should be 0.00  (onbuy took ${m(f.channelTax)})`);
    }
    if (f.collectedByChannel && Math.abs(tax - f.channelTax) > 0.05) {
      ok = false; badTax.push(`${ref}  onbuy took ${m(f.channelTax)}  we recorded ${m(tax)}`);
    }
    if (ok) agree += 1;
  }
  console.log(`\n══════ OnBuy UK — ${onbuy.length} order(s) with money on them ══════`);
  console.log(`  not in our database               ${missing}`);
  console.log(`  agree on all three                ${agree}`);
  console.log(`  wrong "who collected"             ${badFlag.length}`);
  console.log(`  our VAT is not zero               ${badVat.length}`);
  console.log(`  channel tax not recorded          ${badTax.length}`);
  for (const l of badFlag) console.log(`    flag   ${l}`);
  for (const l of badVat) console.log(`    vat    ${l}`);
  for (const l of badTax) console.log(`    tax    ${l}`);

  // ── eBay ────────────────────────────────────────────────────────────────
  const ebay = Object.entries(facts.ebay);
  const ours2 = await load(ebay.map(([r]) => r));
  let m2 = 0, ok2 = 0;
  const flag2 = [], vat2 = [], tax2 = [];
  const byType = {};
  for (const [ref, f] of ebay) {
    const t = ours2.get(ref);
    if (!t) { m2 += 1; continue; }
    const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
    const tax = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    const k = f.crType || 'none';
    byType[k] = byType[k] ?? { n: 0, flagged: 0, vat: 0 };
    byType[k].n += 1;
    if (t.vatCollectedByChannel) byType[k].flagged += 1;
    byType[k].vat += vat;
    let good = true;
    /** Only the VAT type says anything about the VAT flag; GST and sales tax are other regimes. */
    if (f.crType === 'VAT' && f.collectedByChannel && !t.vatCollectedByChannel && (t.destinationCountry?.isoCode ?? '') === 'GB') {
      good = false; flag2.push(`${ref} -> ${f.dest}  ebay collected ${m(f.channelTax)} VAT, ours=false`);
    }
    if (f.collectedByChannel && vat > 0.02) {
      good = false; vat2.push(`${ref} -> ${f.dest}  ${f.crType} collected by eBay, yet we record ${m(vat)} as ours`);
    }
    if (f.collectedByChannel && Math.abs(tax - f.channelTax) > 0.05) {
      good = false; tax2.push(`${ref} -> ${f.dest}  ebay took ${m(f.channelTax)}  we recorded ${m(tax)}`);
    }
    if (good) ok2 += 1;
  }
  console.log(`\n══════ eBay — ${ebay.length} order(s) ══════`);
  console.log(`  not in our database               ${m2}`);
  console.log(`  agree                             ${ok2}`);
  console.log(`  eBay collected but flag is false  ${flag2.length}`);
  console.log(`  eBay collected yet we claim VAT   ${vat2.length}`);
  console.log(`  channel tax not recorded          ${tax2.length}`);
  console.log('\n  by collect-and-remit type:');
  for (const [k, v] of Object.entries(byType)) {
    console.log(`    ${k.padEnd(12)} ${String(v.n).padStart(3)} orders   flagged ours=${v.flagged}   our VAT total ${m(v.vat)}`);
  }
  for (const l of flag2.slice(0, 6)) console.log(`    flag   ${l}`);
  for (const l of vat2.slice(0, 6)) console.log(`    vat    ${l}`);
  for (const l of tax2.slice(0, 6)) console.log(`    tax    ${l}`);

  await prisma.$disconnect();
})().catch(async (e) => { console.error(e?.message ?? e); process.exit(1); });
