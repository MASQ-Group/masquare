/**
 * What step 3 (`repair-channel-collected-tax`) would still find, by destination.
 *
 *   REPORT=step3-preview-gst bash scripts/prod-scan.sh
 *
 * Decided by the SHIPPED rule, not a copy of it — `marketplaceRemitsTax` is compiled from
 * `apps/api/src` by the wrapper. The first version of this file reimplemented the rule and read
 * Switzerland backwards, predicting nothing would be cleared where in fact all of it will be.
 *
 * `refuse` counts orders where VAT sits on the line with no reported total behind it. The repair
 * leaves those alone deliberately: zeroing would destroy the only surviving copy of the figure.
 *
 * Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const { marketplaceRemitsTax } = require('./.compiled/tax-collection.cjs');

const ISOS = (process.env.ISOS ?? 'SG,AU,CH,JP,US,NO').split(',').map((s) => s.trim()).filter(Boolean);

(async () => {
  const p = new PrismaClient();
  for (const iso of ISOS) {
    const rows = await p.salesTransaction.findMany({
      where: {
        deletedAt: null,
        destinationCountry: { isoCode: iso },
        items: { some: { deletedAt: null, OR: [{ vatAmount: { gt: 0 } }, { shippingAmountVat: { gt: 0 } }] } },
      },
      select: {
        transactionRef: true, taxType: true, vatCollectedByChannel: true, currency: true,
        items: { where: { deletedAt: null }, select: { vatAmount: true, shippingAmountVat: true, salesTaxAmount: true } },
      },
    });
    let clear = 0, refuse = 0, keep = 0, clearSum = 0, refuseSum = 0, keepSum = 0;
    const regimes = {};
    const currencies = new Set();
    for (const t of rows) {
      regimes[t.taxType ?? 'null'] = (regimes[t.taxType ?? 'null'] ?? 0) + 1;
      if (t.currency) currencies.add(t.currency);
      const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
      const reported = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
      if (!marketplaceRemitsTax(t)) { keep += 1; keepSum += vat; continue; }
      if (reported === 0) { refuse += 1; refuseSum += vat; } else { clear += 1; clearSum += vat; }
    }
    if (!rows.length) { console.log(`\n  ${iso} — nothing left carrying VAT`); continue; }
    console.log(`\n  ${iso} — ${rows.length} order(s) carrying VAT  [${Object.entries(regimes).map(([k, v]) => `${k}=${v}`).join(', ')}]`
      + `  ${[...currencies].join('/')}`);
    console.log(`    step 3 clears        ${String(clear).padStart(4)}  ${clearSum.toFixed(2)}`);
    console.log(`    step 3 refuses       ${String(refuse).padStart(4)}  ${refuseSum.toFixed(2)}   (no reported total behind the figure)`);
    console.log(`    stays ours, rightly  ${String(keep).padStart(4)}  ${keepSum.toFixed(2)}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
