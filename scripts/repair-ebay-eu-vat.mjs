// Repair eBay orders that were imported with the seller-owed VAT left at zero.
//
// eBay only collects and remits VAT where it is the deemed supplier (UK facilitator, IOSS).
// Everywhere else in the EU VAT zone the seller owes it, and eBay pays over the whole amount the
// buyer paid — so `lineItem.total` is GROSS there. The importer used to record that total as net,
// which booked the VAT as revenue, overstated profit by the full tax, and registered nothing to
// remit. The mapper now splits it; this fixes the rows imported before that.
//
// Scope: source = 'ebay', destination country in the EU VAT zone, and eBay collected nothing on
// the line. Any line that already carries VAT is left alone, so the script is idempotent and
// cannot halve an amount twice.
//
// The VAT comes out of the DESTINATION country's rate, never the marketplace's: a sale on eBay DE
// shipped to Greece is 24%, not Germany's 19%.
//
// Usage:
//   node scripts/repair-ebay-eu-vat.mjs           # dry run — reports, writes nothing
//   node scripts/repair-ebay-eu-vat.mjs --apply   # writes
//
// DATABASE_URL is read from the environment. Against production:
//   DATABASE_URL="$PROD_URL" node scripts/...
// It falls back to the repo-root .env (localhost) ONLY when DATABASE_URL is absent entirely —
// supplying it as an empty string is a hard error, not a silent redirect to the wrong database.

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { announceDatabase } from './db-target.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Resolves DATABASE_URL and prints the host it landed on. An explicitly-supplied-but-empty value
// is a hard error rather than a silent fall back to the local .env — see scripts/db-target.mjs.
announceDatabase(ROOT);

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();
const round2 = (x) => Math.round(x * 100) / 100;

/** Split a gross amount at `pct`. VAT by subtraction so net + vat always equals the gross. */
function split(gross, pct) {
  if (!gross || pct <= 0) return { net: round2(gross ?? 0), vat: 0 };
  const net = round2(gross / (1 + pct / 100));
  return { net, vat: round2(gross - net) };
}

async function main() {
  const rows = await prisma.$queryRaw`
    SELECT i.id, i.transaction_id, i.sku,
           i.net_sales_amount, i.shipping_amount, i.shipping_amount_vat, i.sales_tax_amount,
           t.transaction_ref, t.currency, t.date, t.destination_vat_pct,
           c.iso_code, c.vat_rate, sc.name AS channel
    FROM sales_transaction t
    JOIN sales_transaction_item i ON i.transaction_id = t.id AND i.deleted_at IS NULL
    JOIN country c ON c.id = t.destination_country_id
    LEFT JOIN sales_channel sc ON sc.id = t.sales_channel_id
    WHERE t.deleted_at IS NULL
      AND t.source = 'ebay'
      AND c.eu_vat_zone = true
      AND c.vat_rate > 0
      -- Already split: leave it. This is what makes a re-run safe.
      AND COALESCE(i.vat_amount, 0) = 0
      -- eBay collected and remitted on this line: we owe nothing, the total is genuinely net.
      AND COALESCE(i.sales_tax_amount, 0) = 0
    ORDER BY t.date, t.transaction_ref
  `;

  if (!rows.length) {
    console.log('Nothing to repair — every eBay line with an EU destination already carries its VAT.');
    return;
  }

  const byCurrency = new Map();
  const txIds = new Set();
  const updates = [];

  for (const r of rows) {
    const pct = Number(r.vat_rate);
    const goods = split(Number(r.net_sales_amount ?? 0), pct);
    const ship = split(Number(r.shipping_amount ?? 0), pct);
    const vatTotal = round2(goods.vat + ship.vat);
    txIds.add(r.transaction_id);
    updates.push({ id: r.id, transactionId: r.transaction_id, pct, goods, ship });

    const cur = r.currency ?? '—';
    const agg = byCurrency.get(cur) ?? { lines: 0, grossWas: 0, vat: 0, rates: new Set(), countries: new Set(), channels: new Set() };
    agg.lines++;
    agg.grossWas = round2(agg.grossWas + Number(r.net_sales_amount ?? 0));
    agg.vat = round2(agg.vat + vatTotal);
    agg.rates.add(`${r.iso_code} ${pct}%`);
    agg.countries.add(r.iso_code);
    if (r.channel) agg.channels.add(r.channel);
    byCurrency.set(cur, agg);
  }

  console.log(`${APPLY ? 'Repairing' : 'Dry run —'} ${updates.length} line(s) across ${txIds.size} order(s).\n`);
  for (const [cur, a] of byCurrency) {
    console.log(`  ${cur}: ${a.lines} line(s) over ${a.channels.size ? [...a.channels].join(', ') : 'no channel'}`);
    console.log(`     recorded as net (actually gross)  ${a.grossWas.toFixed(2)} ${cur}`);
    console.log(`     VAT to be recognised             ${a.vat.toFixed(2)} ${cur}   <- comes out of revenue and profit`);
    console.log(`     destinations: ${[...a.rates].sort().join(', ')}`);
  }

  console.log('\nFirst 10 lines:');
  for (const r of rows.slice(0, 10)) {
    const pct = Number(r.vat_rate);
    const g = split(Number(r.net_sales_amount ?? 0), pct);
    console.log(`  ${String(r.transaction_ref).padEnd(22)} ${r.iso_code} ${String(pct).padStart(2)}%  ${String(r.sku ?? '').slice(0, 24).padEnd(24)} ${Number(r.net_sales_amount).toFixed(2)} -> net ${g.net.toFixed(2)} + VAT ${g.vat.toFixed(2)}`);
  }

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

  // One transaction: a half-repaired order would show a VAT liability against the wrong revenue.
  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.salesTransactionItem.update({
        where: { id: u.id },
        data: {
          netSalesAmount: u.goods.net,
          vatAmount: u.goods.vat,
          shippingAmount: u.ship.net,
          shippingAmountVat: u.ship.vat,
        },
      });
    }
    // Snapshot the rate on the order, which is what the column is for — a later change to a
    // country's VAT rate must not silently rewrite what an old order was taxed at.
    for (const id of txIds) {
      const pct = updates.find((u) => u.transactionId === id)?.pct ?? null;
      if (pct != null) await tx.salesTransaction.update({ where: { id }, data: { destinationVatPct: pct } });
    }
  }, { timeout: 60000 });

  console.log(`\nRepaired ${updates.length} line(s) across ${txIds.size} order(s).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
