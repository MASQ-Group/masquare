/**
 * Does availability reach every listing it should?
 *
 *   REPORT=push-coverage bash scripts/prod-scan.sh
 *
 * The rule: one product's availability goes to EVERY listing of that product on every alias SKU
 * that is merchant-fulfilled. FBA is Amazon's to count. A listing the push cannot see — because
 * nothing links it to a product — is stock we believe we are publishing and are not.
 */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();

  const fbmish = { OR: [{ fulfilmentChannel: null }, { fulfilmentChannel: { not: 'FBA' } }] };
  const total = await p.channelListing.count();
  const unmatched = await p.channelListing.count({ where: { productId: null } });
  const unmatchedPushable = await p.channelListing.count({ where: { productId: null, ...fbmish } });
  const fba = await p.channelListing.count({ where: { fulfilmentChannel: 'FBA' } });

  console.log(`  listing rows                                    ${total}`);
  console.log(`  FBA (correctly never pushed)                    ${fba}`);
  console.log(`  NOT matched to a product                        ${unmatched}`);
  console.log(`    of those, merchant-fulfilled — invisible to the push  ${unmatchedPushable}\n`);

  const rows = await p.channelListing.groupBy({
    by: ['integrationId'], where: { productId: null, ...fbmish }, _count: { _all: true },
  });
  const ints = new Map((await p.channelIntegration.findMany({ select: { id: true, name: true } })).map((i) => [i.id, i.name]));
  console.log('  unmatched merchant-fulfilled rows by channel:');
  for (const r of rows.sort((a, b) => b._count._all - a._count._all).slice(0, 12)) {
    console.log(`    ${String(r._count._all).padStart(5)}  ${ints.get(r.integrationId) ?? r.integrationId}`);
  }

  console.log('\n  recent pushes for the IT68277 product (both SKUs):');
  const prod = await p.product.findFirst({ where: { deletedAt: null, mainSku: 'IT68277' }, select: { id: true } });
  const pushes = await p.channelPush.findMany({
    where: { productId: prod?.id }, orderBy: { createdAt: 'desc' }, take: 14,
    select: { channelSku: true, integrationId: true, requestedValue: true, previousValue: true, ok: true, message: true, createdAt: true, dryRun: true },
  });
  for (const x of pushes) {
    console.log(`    ${x.createdAt.toISOString().slice(0, 16)} ${String(ints.get(x.integrationId) ?? '').padEnd(15)}`
      + ` sku=${x.channelSku.padEnd(11)} ${x.previousValue ?? '—'}->${x.requestedValue ?? '—'}`
      + ` ${x.ok ? 'ok' : 'FAILED'}${x.dryRun ? ' (dry)' : ''} ${(x.message ?? '').slice(0, 60)}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
