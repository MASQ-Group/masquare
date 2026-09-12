/**
 * eBay orders the marketplace collected VAT on, for destinations OUTSIDE the UK.
 *
 *   FACTS=<channel-facts.json> REPORT=ebay-nonuk-collected bash scripts/prod-scan.sh
 *
 * `channelRemitsTheVat` requires a UK destination, so these cannot be flagged however plainly eBay
 * reports collecting. Unlike the UK case — where the money was already right and only the label was
 * missing — here the tax may genuinely be sitting on our side of the books.
 *
 * Reads only. Names the orders so the question can be answered with cases rather than in principle.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const FACTS = process.env.FACTS;
(async () => {
  const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8')).ebay;
  const p = new PrismaClient();
  const refs = Object.keys(facts);
  const txs = await p.salesTransaction.findMany({
    where: { deletedAt: null, transactionRef: { in: refs } },
    select: { transactionRef: true, taxType: true, vatCollectedByChannel: true, destinationVatPct: true,
      destinationCountry: { select: { isoCode: true } },
      items: { where: { deletedAt: null }, select: { vatAmount: true, salesTaxAmount: true } } },
  });
  const ours = new Map(txs.map((t) => [t.transactionRef, t]));
  console.log('  eBay collected, destination NOT the UK:\n');
  let n = 0, tax = 0, ourVat = 0;
  for (const [ref, f] of Object.entries(facts)) {
    if (!f.collectedByChannel) continue;
    const t = ours.get(ref);
    if (!t) continue;
    if ((t.destinationCountry?.isoCode ?? '') === 'GB') continue;
    const v = t.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0);
    const c = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
    n += 1; tax += c; ourVat += v;
    console.log(`    ${ref}  -> ${String(f.dest).padEnd(14)} ${String(f.crType).padEnd(10)} ${String(f.crRate).padStart(5)}%`
      + `  ebay took ${c.toFixed(2)}   we record ${v.toFixed(2)} as ours   regime=${t.taxType}  rate=${t.destinationVatPct ?? '—'}%`);
  }
  console.log(`\n  ${n} order(s); eBay took ${tax.toFixed(2)}; we record ${ourVat.toFixed(2)} of it as ours`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
