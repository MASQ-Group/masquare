/**
 * Sales channels sharing a name — which are real, and which are configured differently.
 *
 *   node scripts/channel-duplicates.cjs
 *
 * A repeated name is NOT automatically a fault here. Channels are per-company by design — two
 * companies each selling on Amazon UK legitimately hold their own "Amazon UK", and orders, listings
 * and integrations are scoped to one company throughout. Reporting those as duplicates would send
 * somebody to delete a channel another company trades on.
 *
 * What IS a fault is two channels with the same name AND the same owner, or a set of same-named
 * channels whose VAT threshold rules disagree — because the rule decides how much VAT an order is
 * assessed at, and an order landing on the unconfigured twin falls through to the country rate
 * instead. Both are reported, separately, with the order counts that say which one is live.
 *
 * Writes nothing.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/src/app.module');
const { PrismaService } = require('../apps/api/dist/src/prisma/prisma.service');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  const channels = await prisma.salesChannel.findMany({
    where: { deletedAt: null },
    select: {
      id: true, name: true, companyId: true, nativeCurrency: true, createdAt: true,
      vatThresholdEnabled: true, vatThresholdAmount: true,
      vatBelowThresholdPct: true, vatAboveThresholdPct: true,
      company: { select: { officialName: true } },
      _count: { select: { salesTransactions: true } },
    },
    orderBy: { name: 'asc' },
  });

  const byName = new Map();
  for (const c of channels) {
    const k = c.name.trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(c);
  }

  const shared = [...byName.entries()].filter(([, list]) => list.length > 1);
  console.log(`  sales channels (not deleted)                      ${channels.length}`);
  console.log(`  names used by more than one channel               ${shared.length}\n`);

  const sameOwner = [];
  const ruleDisagreement = [];

  for (const [, list] of shared) {
    const owners = list.map((c) => c.companyId ?? 'none');
    if (new Set(owners).size !== owners.length) sameOwner.push(list);

    const rule = (c) => (c.vatThresholdEnabled
      ? `${c.vatThresholdAmount}/${c.vatBelowThresholdPct}/${c.vatAboveThresholdPct}`
      : 'off');
    if (new Set(list.map(rule)).size > 1) ruleDisagreement.push(list);
  }

  const show = (list) => {
    console.log(`  ${list[0].name}`);
    for (const c of list.sort((a, b) => b._count.salesTransactions - a._count.salesTransactions)) {
      const rule = c.vatThresholdEnabled
        ? `threshold ${c.vatThresholdAmount} · below ${c.vatBelowThresholdPct}% · above ${c.vatAboveThresholdPct}%`
        : 'threshold OFF';
      console.log(`    ${String(c._count.salesTransactions).padStart(5)} orders  `
        + `${(c.company?.officialName ?? 'no company').padEnd(28)} ${rule}`);
      console.log(`          created ${c.createdAt.toISOString().slice(0, 10)}  id ${c.id}`);
    }
    console.log('');
  };

  /**
   * The dangerous one, and the reason the whole report exists. Orders landing on the twin without a
   * threshold rule are assessed at the destination country rate instead, so the same marketplace
   * produces two different VAT answers depending on which row the order was attached to.
   */
  console.log('── Same name, DIFFERENT VAT rules ───────────────────────────');
  if (!ruleDisagreement.length) console.log('  none\n');
  for (const list of ruleDisagreement) show(list);

  /** Same name AND same owner: nothing distinguishes these, so one of them is a mistake. */
  console.log('── Same name AND same company ───────────────────────────────');
  if (!sameOwner.length) console.log('  none — every repeated name belongs to a different company, which is by design\n');
  for (const list of sameOwner) show(list);

  console.log('── Every repeated name, for context ─────────────────────────');
  for (const [, list] of shared) show(list);

  await app.close();
})().catch(async (e) => { console.error(e?.message ?? e); process.exit(1); });
