/**
 * How close the platform is to creating an eBay listing, on the real catalogue.
 *
 *   REPORT=listing-readiness-review bash scripts/prod-scan.sh
 *
 * The code path exists; the question is whether anything could go down it. eBay makes us supply the
 * entire listing — title, description, images, category, aspects — where Amazon only needs an offer
 * attached to somebody else's catalogue entry. So readiness is a catalogue question, not a code one.
 *
 * Reads only.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();

  const settings = await p.platformSettings.findFirst({ select: { listingLiveWrites: true } });
  console.log(`\n  the master switch\n`);
  console.log(`    listingLiveWrites  ${settings?.listingLiveWrites ?? '(no settings row)'}`
    + `   <- false means publish refuses before touching a channel`);

  const integrations = await p.channelIntegration.findMany({
    where: { deletedAt: null, channelType: { in: ['ebay', 'onbuy'] } },
    select: { id: true, name: true, channelType: true, status: true },
  });
  console.log(`\n  connections\n`);
  for (const i of integrations) console.log(`    ${i.channelType.padEnd(7)} ${i.name.padEnd(22)} ${i.status}`);

  const total = await p.product.count({ where: { deletedAt: null } });
  const counts = await Promise.all([
    p.product.count({ where: { deletedAt: null, OR: [{ ebayTitle: { not: null } }, { title: { not: '' } }] } }),
    p.product.count({ where: { deletedAt: null, descriptionHtml: { not: null } } }),
    p.product.count({ where: { deletedAt: null, media: { some: { deletedAt: null } } } }),
    p.product.count({ where: { deletedAt: null, OR: [{ ean: { not: null } }, { upc: { not: null } }] } }),
    p.product.count({ where: { deletedAt: null, brandId: { not: null } } }),
  ]);
  const labels = ['a title', 'a description', 'at least one image', 'an EAN or UPC', 'a brand'];
  console.log(`\n  what the ${total} products carry — eBay needs ALL of the first three\n`);
  counts.forEach((n, i) => {
    const pct = ((n / total) * 100).toFixed(1);
    console.log(`    ${labels[i].padEnd(22)} ${String(n).padStart(5)}  ${pct.padStart(5)}%`);
  });

  const ready = await p.product.count({
    where: {
      deletedAt: null,
      descriptionHtml: { not: null },
      media: { some: { deletedAt: null } },
      OR: [{ ebayTitle: { not: null } }, { title: { not: '' } }],
    },
  });
  console.log(`\n    title + description + image, all three   ${ready}  (${((ready / total) * 100).toFixed(1)}%)`);

  /** The per-channel plan is where an eBay category and its aspects would live. */
  /**
   * A plan is where a product's eBay category and aspects are chosen — the two things `preview`
   * cannot invent and `publish` refuses without.
   *
   * No `.catch()` swallowing the error here: the first version asked to group by a column that does
   * not exist and reported "table not reachable", which is a different and much more alarming thing
   * than the mistake it actually was.
   */
  const plans = await p.productChannelPlan.findMany({
    select: { integrationId: true, marketplace: true, categoryRef: true, offerPriceCents: true, deliveryTemplate: true },
  });
  const ints = new Map((await p.channelIntegration.findMany({ select: { id: true, name: true, channelType: true } }))
    .map((i) => [i.id, i]));
  console.log(`
  channel plans — where an eBay category and its aspects would be chosen
`);
  if (!plans.length) {
    console.log(`    none. No product has a plan on any channel, so no category has been picked anywhere.`);
  } else {
    const by = new Map();
    for (const pl of plans) {
      const i = ints.get(pl.integrationId);
      const k = `${i?.channelType ?? '?'} ${i?.name ?? pl.integrationId}${pl.marketplace ? ' ' + pl.marketplace : ''}`;
      const e = by.get(k) ?? { n: 0, withCategory: 0, withPrice: 0 };
      e.n += 1;
      if (pl.categoryRef) e.withCategory += 1;
      if (pl.offerPriceCents != null) e.withPrice += 1;
      by.set(k, e);
    }
    for (const [k, e] of by) {
      console.log(`    ${k.padEnd(30)} ${String(e.n).padStart(4)} plan(s), ${e.withCategory} with a category, ${e.withPrice} with a price`);
    }
  }

  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
