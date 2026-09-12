/**
 * Run the repair's judgement over production without writing — the shipped planner, real rows.
 *
 *   REPORT=step3-plan bash scripts/prod-scan.sh
 *
 * The dry run already reports totals; this reports the DECISION, order by order, and names which of
 * the three branches each one took. Worth having separately because a branch that moves money is
 * one you want to watch land on the orders you expected and no others.
 *
 * Reads only.
 */
const { PrismaClient } = require('@prisma/client');
const { planChannelTaxRepair } = require('./.compiled/channel-tax-repair-plan.cjs');

(async () => {
  const p = new PrismaClient();
  const txs = await p.salesTransaction.findMany({
    where: { deletedAt: null, salesChannelId: { not: null }, vatOverridden: false },
    select: {
      transactionRef: true, date: true, taxType: true, vatCollectedByChannel: true, currency: true,
      destinationCountry: { select: { isoCode: true } },
      salesChannel: { select: { name: true } },
      items: { where: { deletedAt: null }, select: { id: true, vatAmount: true, shippingAmountVat: true, salesTaxAmount: true } },
    },
    orderBy: { date: 'asc' },
  });

  const moves = [], zeroes = [], refusals = [];
  for (const t of txs) {
    const plan = planChannelTaxRepair(t);
    if (plan.action === 'skip') continue;
    if (plan.action === 'refuse') { refusals.push({ t }); continue; }
    if (plan.move.length) moves.push({ t, plan });
    if (plan.zero.length) zeroes.push({ t, plan });
  }

  const where = (t) => `${t.date.toISOString().slice(0, 10)}  ${t.transactionRef}  ${String(t.salesChannel?.name ?? '?').padEnd(12)}`
    + ` -> ${t.destinationCountry?.isoCode}  ${t.currency}`;

  console.log(`\n  ${txs.length} order(s) considered\n`);
  console.log(`    moved into salesTaxAmount  ${String(moves.length).padStart(4)} order(s)`);
  for (const { t, plan } of moves) {
    console.log(`        ${where(t)}  regime=${t.taxType}`);
    for (const mv of plan.move) console.log(`            line ${mv.id.slice(0, 8)}…  ${mv.salesTaxAmount.toFixed(2)} out of vatAmount, into salesTaxAmount`);
  }
  console.log(`\n    zeroed (figure survives)   ${String(zeroes.length).padStart(4)} order(s)`);
  console.log(`\n    refused                    ${String(refusals.length).padStart(4)} order(s)`);
  for (const { t } of refusals) console.log(`        ${where(t)}  regime=${t.taxType}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
