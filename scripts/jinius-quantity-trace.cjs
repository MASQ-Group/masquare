/**
 * Where a Jinius quantity on screen came from: a pull, or a push we recorded as done.
 *
 *   REPORT=jinius-quantity-trace bash scripts/prod-scan.sh
 *
 * Read-only. Written when 65-16567828 showed 3 units on the listing and Jinius held 1.
 *
 * The listing figure has two possible authors. A PULL reads it back from Jinius, so it is theirs.
 * A PUSH writes it the moment the push is judged to have worked - and a Mirakl offer write is only
 * QUEUED when it answers, so a push recorded as done proves nothing about what Jinius ended up
 * holding. This separates the two, and shows where they disagree.
 */
const { PrismaClient } = require('@prisma/client');

const WANTED = '65-16567828';
const when = (d) => (d ? d.toISOString().replace('T', ' ').slice(0, 19) : 'never');

(async () => {
  const p = new PrismaClient();
  const ints = await p.channelIntegration.findMany({
    where: { channelType: 'jinius', deletedAt: null },
    select: { id: true, name: true },
  });
  if (!ints.length) { console.log('No Jinius connection.'); await p.$disconnect(); return; }
  const ids = ints.map((i) => i.id);

  const rows = await p.channelListing.findMany({
    where: { integrationId: { in: ids } },
    select: { channelSku: true, productId: true, listedQuantity: true, listingStatus: true, lastPulledAt: true, lastPushedAt: true },
  });
  console.log(`Jinius listing rows: ${rows.length}`);

  /**
   * A row whose last write was a push carries OUR number, not theirs - and it has not been read back
   * since. That is the population where the screen can disagree with the marketplace.
   */
  const pushedSince = rows.filter((r) => r.lastPushedAt && (!r.lastPulledAt || r.lastPushedAt > r.lastPulledAt));
  console.log(`  last written by a push, not read back since: ${pushedSince.length}`);
  const everPushed = rows.filter((r) => r.lastPushedAt);
  console.log(`  ever pushed: ${everPushed.length}`);
  const statuses = new Map();
  for (const r of rows) statuses.set(r.listingStatus, (statuses.get(r.listingStatus) ?? 0) + 1);
  console.log(`  listingStatus now: ${[...statuses].map(([s, n]) => `${n} x ${s == null ? 'null' : `"${s}"`}`).join(', ')}`);
  const pulled = rows.map((r) => r.lastPulledAt).filter(Boolean).sort();
  console.log(`  newest lastPulledAt: ${when(pulled[pulled.length - 1])}`);

  // Every quantity push the platform has sent to Jinius, newest first.
  const pushes = await p.channelPush.findMany({
    where: { integrationId: { in: ids } },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { channelSku: true, field: true, requestedValue: true, previousValue: true, ok: true, dryRun: true, message: true, createdAt: true },
  });
  console.log(`\nMost recent pushes to Jinius (${pushes.length} shown):`);
  for (const x of pushes) {
    console.log(`  ${when(x.createdAt)} ${x.field} ${x.channelSku} ${x.previousValue ?? '—'} -> ${x.requestedValue}${x.dryRun ? ' [dry run]' : ''} ${x.ok ? 'ok' : 'FAILED'}: ${x.message}`);
  }

  console.log(`\n${WANTED}`);
  const product = await p.product.findFirst({
    where: { deletedAt: null, OR: [{ mainSku: WANTED }, { aliases: { some: { skuValue: WANTED, deletedAt: null } } }] },
    select: { id: true, mainSku: true, title: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  if (!product) {
    console.log('  no product here holds that SKU.');
  } else {
    const avail = await p.productAvailability.findFirst({ where: { productId: product.id }, select: { quantity: true, updatedAt: true } });
    console.log(`  ${product.mainSku} - ${product.title ?? ''}`);
    console.log(`  aliases: ${product.aliases.map((a) => a.skuValue).join(', ') || 'none'}`);
    console.log(`  availability here: ${avail ? `${avail.quantity} (updated ${when(avail.updatedAt)})` : 'no record'}`);
    const its = await p.channelListing.findMany({
      where: { productId: product.id },
      select: { channelSku: true, listedQuantity: true, listingStatus: true, lastPulledAt: true, lastPushedAt: true, integration: { select: { name: true, channelType: true } } },
    });
    for (const l of its) {
      console.log(`  ${l.integration.channelType} ${l.channelSku}: qty=${l.listedQuantity ?? '—'} status=${l.listingStatus ?? 'null'} pulled=${when(l.lastPulledAt)} pushed=${when(l.lastPushedAt)}`);
    }
    const hist = await p.channelPush.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { channelSku: true, integrationId: true, field: true, requestedValue: true, previousValue: true, ok: true, dryRun: true, message: true, createdAt: true },
    });
    const named = new Map((await p.channelIntegration.findMany({ select: { id: true, channelType: true } })).map((i) => [i.id, i.channelType]));
    console.log(`  push history (${hist.length}):`);
    for (const x of hist) {
      console.log(`    ${when(x.createdAt)} ${named.get(x.integrationId) ?? '?'} ${x.field} ${x.previousValue ?? '—'} -> ${x.requestedValue}${x.dryRun ? ' [dry run]' : ''} ${x.ok ? 'ok' : 'FAILED'}: ${x.message}`);
    }
  }

  /**
   * Orders on Jinius for the same SKU, and what state they are in.
   *
   * Mirakl holds stock against an order that has not shipped yet. If their portal shows what is
   * still SELLABLE while OF21 answers with what the offer was SET to, the difference between the
   * two figures is exactly the units sitting in orders - and that is arithmetic we can check here
   * rather than a theory about their API.
   */
  const lines = await p.jiniusOrderLine.findMany({
    where: { offerSku: WANTED },
    select: { quantity: true, order: { select: { orderId: true, commercialId: true, state: true, orderedAt: true } } },
  });
  console.log(`
Jinius order lines for ${WANTED}: ${lines.length}`);
  const held = new Map();
  for (const l of lines) {
    console.log(`  ${l.order.commercialId ?? l.order.orderId} ${when(l.order.orderedAt)} ${l.order.state} qty=${l.quantity}`);
    held.set(l.order.state, (held.get(l.order.state) ?? 0) + l.quantity);
  }
  if (held.size) console.log(`  units by state: ${[...held].map(([s, n]) => `${s}=${n}`).join(', ')}`);

  await p.$disconnect();
})();
