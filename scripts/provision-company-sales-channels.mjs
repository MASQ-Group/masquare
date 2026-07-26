// Provision per-company sales channels after making SalesChannel company-owned.
//
// Model: the OLDEST company (masquare) owns every pre-existing sales channel (done by
// the migration backfill). Every OTHER company should get its OWN copy of the Amazon
// channels + the Local Sales channel — and nothing else. Their existing sales
// transactions / FBA shipments, which still point at the source company's channels,
// are repointed to the freshly-cloned equivalents so no data references another
// company's channel.
//
// Idempotent: a target company that already has its own sales channels is skipped.
//
// Usage:  node scripts/provision-company-sales-channels.mjs
// DATABASE_URL is read from the environment, falling back to the repo-root .env.

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

if (!process.env.DATABASE_URL) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  try {
    for (const line of readFileSync(root, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* env already provided */ }
}

const prisma = new PrismaClient();

// A source channel is cloned for other companies only if it's Local Sales or Amazon.
const shouldClone = (c) => c.kind === 'local' || /^amazon\b/i.test(c.name.trim());

const CLONE_FIELDS = [
  'name', 'description', 'kind', 'showTransactionTotal', 'chipBgColor', 'chipTextColor',
  'nativeCountryId', 'nativeCurrency', 'generalSalesFeePct', 'feeChargedInNativeCurrency',
  'feeCurrency', 'vatThresholdEnabled', 'vatThresholdAmount', 'vatThresholdCurrency',
  'vatBelowThresholdPct', 'vatAboveThresholdPct', 'email', 'website', 'contactName',
];

async function main() {
  const companies = await prisma.company.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, officialName: true } });
  if (companies.length < 2) { console.log('Only one company — nothing to provision.'); return; }

  const source = companies[0];
  const targets = companies.slice(1);
  console.log(`Source (owns existing channels): ${source.officialName}`);

  const sourceChannels = await prisma.salesChannel.findMany({ where: { companyId: source.id, deletedAt: null } });
  const toClone = sourceChannels.filter(shouldClone);
  console.log(`Source has ${sourceChannels.length} channels; ${toClone.length} qualify to clone (Amazon + Local Sales).`);

  for (const target of targets) {
    const existing = await prisma.salesChannel.count({ where: { companyId: target.id, deletedAt: null } });
    if (existing > 0) { console.log(`\n${target.officialName}: already has ${existing} channels — skipping.`); continue; }

    console.log(`\n${target.officialName}: cloning ${toClone.length} channels…`);
    const map = new Map(); // sourceChannelId -> targetChannelId
    for (const sc of toClone) {
      const data = { companyId: target.id };
      for (const f of CLONE_FIELDS) data[f] = sc[f];
      const clone = await prisma.salesChannel.create({ data });
      map.set(sc.id, clone.id);
    }
    console.log(`  created ${map.size} channels.`);

    // Repoint this company's transactions / FBA shipments off the source channel onto the clone.
    let txMoved = 0, fbaMoved = 0;
    for (const [srcId, tgtId] of map) {
      const t = await prisma.salesTransaction.updateMany({ where: { companyId: target.id, salesChannelId: srcId, deletedAt: null }, data: { salesChannelId: tgtId } });
      const f = await prisma.fbaShipment.updateMany({ where: { companyId: target.id, salesChannelId: srcId, deletedAt: null }, data: { salesChannelId: tgtId } });
      txMoved += t.count; fbaMoved += f.count;
    }
    console.log(`  repointed ${txMoved} sales transactions, ${fbaMoved} FBA shipments.`);

    // Safety check: any of this company's records still pointing at a source channel we did NOT clone?
    const srcIds = sourceChannels.map((c) => c.id);
    const stray = await prisma.salesTransaction.count({ where: { companyId: target.id, salesChannelId: { in: srcIds }, deletedAt: null } });
    const strayFba = await prisma.fbaShipment.count({ where: { companyId: target.id, salesChannelId: { in: srcIds }, deletedAt: null } });
    if (stray || strayFba) console.warn(`  ⚠ ${stray} transactions + ${strayFba} FBA shipments still reference a source channel not cloned for this company. Review manually.`);
  }

  console.log('\nDone.');
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
