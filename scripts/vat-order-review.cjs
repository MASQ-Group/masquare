/**
 * Compare what we stored against Amazon's own VAT Transactions Report, order by order.
 *
 *   FACTS=<path to amazon-facts.json> REPORT=vat-order-review bash scripts/prod-scan.sh
 *
 * The report is the answer; this says where we disagree with it, grouped by the scheme Amazon
 * applied — because the schemes fail differently and a single total would hide that.
 *
 * Amazon's figures include shipping; ours keep it in its own column. Both sides are totalled the
 * same way here, or every order with postage would read as a disagreement it is not.
 *
 * Writes nothing.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const FACTS = process.env.FACTS;
if (!FACTS) { console.error('Set FACTS to the extracted Amazon facts JSON.'); process.exit(1); }

const m = (n) => (n == null ? '—' : Number(n).toFixed(2));
const near = (a, b, tol) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) <= tol;

(async () => {
  const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
  const prisma = new PrismaClient();

  for (const [group, orders] of Object.entries(facts)) {
    const ids = Object.keys(orders);
    const txs = await prisma.salesTransaction.findMany({
      where: { deletedAt: null, transactionRef: { in: ids } },
      select: {
        transactionRef: true, destinationVatPct: true, vatCollectedByChannel: true, taxType: true,
        vatOverridden: true,
        destinationCountry: { select: { isoCode: true } },
        items: {
          where: { deletedAt: null },
          select: { vatAmount: true, netSalesAmount: true, shippingAmount: true, shippingAmountVat: true },
        },
      },
    });
    const ours = new Map(txs.map((t) => [t.transactionRef, t]));
    const byScheme = new Map();

    for (const [id, f] of Object.entries(orders)) {
      const t = ours.get(id);
      const key = `${f.scheme}/${f.resp}`;
      const b = byScheme.get(key) ?? { n: 0, missing: 0, who: [], rate: [], amount: [], vatOurs: 0, vatAmazon: 0 };
      b.n += 1;
      if (!t) { b.missing += 1; byScheme.set(key, b); continue; }

      const net = t.items.reduce((s, i) => s + (i.netSalesAmount ?? 0) + (i.shippingAmount ?? 0), 0);
      const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
      b.vatOurs += vat;
      b.vatAmazon += f.totVat;

      if (!!t.vatCollectedByChannel !== (f.resp === 'MARKETPLACE')) {
        b.who.push(`${id}  amazon=${f.resp === 'MARKETPLACE'} ours=${!!t.vatCollectedByChannel}  net ${m(f.totNet)}`);
      }
      if (!near(t.destinationVatPct ?? 0, Number(f.rate) * 100, 0.51)) {
        b.rate.push(`${id} -> ${f.arr}  amazon ${(Number(f.rate) * 100).toFixed(1)}%  ours ${t.destinationVatPct ?? '—'}%${t.vatOverridden ? ' (overridden)' : ''}`);
      }
      // 2% of the order, or 5p, whichever is larger — Amazon rounds per line and we round per order.
      if (!near(vat, f.totVat, Math.max(0.05, Math.abs(f.totVat) * 0.02))) {
        b.amount.push(`${id}  amazon ${m(f.totVat)}  ours ${m(vat)}   (net: amazon ${m(f.totNet)}, ours ${m(net)})`);
      }
      byScheme.set(key, b);
    }

    console.log(`\n══════ ${group} — ${ids.length} order(s) ══════`);
    for (const [scheme, b] of [...byScheme.entries()].sort((a, b2) => b2[1].n - a[1].n)) {
      console.log(`\n  ${scheme}  (${b.n} order${b.n === 1 ? '' : 's'})`);
      if (b.missing) console.log(`    not in our database        ${b.missing}`);
      console.log(`    who collected — disagree   ${b.who.length}`);
      console.log(`    VAT rate — disagree        ${b.rate.length}`);
      console.log(`    VAT amount — disagree      ${b.amount.length}`);
      console.log(`    VAT total: amazon ${m(b.vatAmazon)}  ours ${m(b.vatOurs)}  difference ${m(b.vatOurs - b.vatAmazon)}`);
      const show = (label, list, n = 4) => {
        if (!list.length) return;
        console.log(`      ${label}:`);
        for (const l of list.slice(0, n)) console.log(`        ${l}`);
        if (list.length > n) console.log(`        …and ${list.length - n} more`);
      };
      show('who', b.who);
      show('rate', b.rate);
      show('amount', b.amount);
    }
  }

  await prisma.$disconnect();
})().catch(async (e) => { console.error(e?.message ?? e); process.exit(1); });
