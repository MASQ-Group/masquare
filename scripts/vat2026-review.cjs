/**
 * Every channel's own 2026 figures against what we stored.
 *
 *   FACTS=<vat2026.json> REPORT=vat2026-review bash scripts/prod-scan.sh
 *
 * What each source can actually answer differs, and pretending otherwise is how a check turns into
 * a guess:
 *
 *   Amazon EU        a VAT Transactions Report. States TAX_COLLECTION_RESPONSIBILITY, so it can
 *                    settle who collected as well as how much.
 *   Amazon non-EU    ORDER reports. They carry `item-tax` and nothing about who kept it, so they
 *                    cannot settle responsibility. They can still check the amount twice over: that
 *                    we hold what is ours, and that we CAPTURED what is not.
 *
 * That second half is new, and the report was misleading without it. Once the GST and sales-tax
 * regimes correctly stopped counting Amazon's tax as ours, a plain vatAmount comparison called every
 * one of those orders a mismatch — 145 of Australia's 184 "differ", all of them right. A check that
 * reports a correct state as an error is worse than no check, because the next person learns to
 * scroll past it. Now `ours` is measured against what the rule says it SHOULD be, and the channel's
 * own figure is verified separately in `salesTaxAmount`, where it is kept.
 *
 * Reads only.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { marketplaceRemitsTax } = require('./.compiled/tax-collection.cjs');

const FACTS = process.env.FACTS;
if (!FACTS) { console.error('Set FACTS to the extracted 2026 JSON.'); process.exit(1); }
const m = (x) => Number(x ?? 0).toFixed(2);
const near = (a, b, tol) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) <= tol;

(async () => {
  const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
  const p = new PrismaClient();

  const load = async (refs) => {
    const out = new Map();
    for (let i = 0; i < refs.length; i += 1000) {
      const rows = await p.salesTransaction.findMany({
        where: { deletedAt: null, transactionRef: { in: refs.slice(i, i + 1000) } },
        select: {
          transactionRef: true, taxType: true, vatCollectedByChannel: true, destinationVatPct: true,
          destinationCountry: { select: { isoCode: true } },
          salesChannel: { select: { name: true } },
          items: {
            where: { deletedAt: null },
            select: { netSalesAmount: true, vatAmount: true, shippingAmountVat: true, salesTaxAmount: true },
          },
        },
      });
      for (const r of rows) out.set(r.transactionRef, r);
    }
    return out;
  };

  // ── Amazon EU — the only sheet that can settle responsibility ───────────
  {
    const entries = Object.entries(facts.amazonEu);
    const ours = await load(entries.map(([r]) => r));
    const byScheme = new Map();
    let missing = 0;
    for (const [ref, f] of entries) {
      const t = ours.get(ref);
      const k = `${f.scheme}/${f.resp}`;
      const b = byScheme.get(k) ?? { n: 0, missing: 0, who: 0, amount: 0, theirVat: 0, ourVat: 0, ex: [] };
      b.n += 1;
      if (!t) { b.missing += 1; missing += 1; byScheme.set(k, b); continue; }
      const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
      const theirs = f.vat + f.shipVat;
      b.theirVat += theirs; b.ourVat += vat;
      if (!!t.vatCollectedByChannel !== (f.resp === 'MARKETPLACE')) b.who += 1;
      if (!near(vat, theirs, Math.max(0.05, Math.abs(theirs) * 0.02))) {
        b.amount += 1;
        if (b.ex.length < 3) b.ex.push(`${ref} -> ${f.arr}  amazon ${m(theirs)}  ours ${m(vat)}`);
      }
      byScheme.set(k, b);
    }
    console.log(`\n══════ Amazon EU — ${entries.length} sale(s), ${missing} not in our database ══════`);
    for (const [k, b] of [...byScheme.entries()].sort((a, c) => c[1].n - a[1].n)) {
      console.log(`\n  ${k}  (${b.n})`);
      console.log(`    not ours to check   ${b.missing}`);
      console.log(`    who collected wrong ${b.who}`);
      console.log(`    amount wrong        ${b.amount}`);
      console.log(`    VAT amazon ${m(b.theirVat)}   ours ${m(b.ourVat)}   difference ${m(b.ourVat - b.theirVat)}`);
      for (const e of b.ex) console.log(`      ${e}`);
    }
  }

  // ── Amazon order reports — both halves of the amount ────────────────────
  for (const key of ['AmazonAmerica', 'AmazonAUS', 'AmazonJP', 'AmazonSA', 'AmazonAE', 'AmazonSG']) {
    const entries = Object.entries(facts[key] ?? {});
    if (!entries.length) continue;
    const ours = await load(entries.map(([r]) => r));
    let missing = 0, agree = 0, wrong = 0, notCaptured = 0;
    let theirTotal = 0, keptTotal = 0, shouldKeep = 0, flagged = 0;
    const ex = [];
    const regimes = {};
    for (const [ref, f] of entries) {
      const t = ours.get(ref);
      if (!t) { missing += 1; continue; }
      const vat = t.items.reduce((s, i) => s + (i.vatAmount ?? 0) + (i.shippingAmountVat ?? 0), 0);
      const captured = t.items.reduce((s, i) => s + (i.salesTaxAmount ?? 0), 0);
      const theirs = f.itemTax + f.shipTax;
      const tol = Math.max(0.05, Math.abs(theirs) * 0.02);

      const remits = marketplaceRemitsTax(t);   // the shipped rule, not a second opinion
      const expected = remits ? 0 : theirs;     // what our own tax figure SHOULD be

      theirTotal += theirs; keptTotal += vat; shouldKeep += expected;
      if (t.vatCollectedByChannel) flagged += 1;
      regimes[t.taxType ?? 'null'] = (regimes[t.taxType ?? 'null'] ?? 0) + 1;

      if (!near(vat, expected, tol)) {
        wrong += 1;
        if (ex.length < 5) ex.push(`${ref} -> ${f.dest}  ours ${m(vat)}  should be ${m(expected)}  (channel took ${m(theirs)}, price ${m(f.price)})`);
      } else if (remits && theirs !== 0 && !near(captured, theirs, tol)) {
        /**
         * Right answer, lost evidence. The tax is correctly not ours, but `salesTaxAmount` is the
         * only place the channel's own figure survives the repair — if it does not match, the
         * order can no longer be reconciled against the channel at all.
         */
        notCaptured += 1;
        if (ex.length < 5) ex.push(`${ref} -> ${f.dest}  not ours, correctly — but we recorded ${m(captured)} where the channel took ${m(theirs)}`);
      } else agree += 1;
    }
    console.log(`
══════ ${key} — ${entries.length} order(s) ══════`);
    console.log(`  not in our database        ${missing}`);
    console.log(`  correct                    ${agree}`);
    console.log(`  our tax figure wrong       ${wrong}`);
    console.log(`  channel's figure not kept  ${notCaptured}`);
    console.log(`  flagged as channel-collected ${flagged}`);
    console.log(`  channel took ${m(theirTotal)}   ours to keep ${m(shouldKeep)}   we hold ${m(keptTotal)}   difference ${m(keptTotal - shouldKeep)}`);
    console.log(`  stored regimes: ${Object.entries(regimes).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    for (const e of ex) console.log(`    ${e}`);
  }

  await p.$disconnect();
})().catch(async (e) => { console.error(e?.message ?? e); process.exit(1); });
