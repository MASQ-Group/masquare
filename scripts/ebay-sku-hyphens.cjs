/**
 * Does eBay take a SKU with a hyphen, and do our stripped SKUs cost us orders?
 *
 *   REPORT=ebay-sku-hyphens bash scripts/prod-scan.sh
 *
 * Listings the platform publishes to eBay carry the product's SKU with its punctuation stripped —
 * LE-83306 goes out as LE83306 — on the strength of a rule written into the code on 26 August:
 * "eBay SKUs are alphanumeric only". That rule was asserted, not observed. The same commit says the
 * account had no Inventory API items at the time, so no refusal could have taught it.
 *
 * Two questions decide whether to undo it, and both are answered by data we already hold:
 *
 *   1. Does eBay already carry SKUs WITH hyphens on this account? If it does, the rule is wrong for
 *      eBay generally, whatever the Inventory API turns out to say.
 *   2. Are orders for a stripped SKU arriving without a product attached? That is the cost of the
 *      mismatch, and it is the thing that actually matters.
 *
 * Read-only.
 */
const { PrismaClient } = require('@prisma/client');

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const loose = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

(async () => {
  const p = new PrismaClient();

  const ebayIntegrations = await p.channelIntegration.findMany({
    where: { channelType: 'ebay' },
    select: { id: true, name: true },
  });
  const ebayIds = ebayIntegrations.map((i) => i.id);

  // ── 1. does eBay hold hyphenated SKUs? ───────────────────────────────────────────────────────
  const listings = await p.channelListing.findMany({
    where: { integrationId: { in: ebayIds } },
    select: {
      channelSku: true, productId: true, listedQuantity: true, externalListingId: true,
      product: { select: { mainSku: true } },
    },
  });
  const hyphenated = listings.filter((l) => (l.channelSku ?? '').includes('-'));
  const withProduct = listings.filter((l) => l.product?.mainSku);
  const stripped = withProduct.filter((l) =>
    l.channelSku !== l.product.mainSku
    && loose(l.channelSku) === loose(l.product.mainSku)
    && /[^a-zA-Z0-9]/.test(l.product.mainSku));

  console.log(`  eBay listings                        ${listings.length}`);
  console.log(`  with a hyphen in the eBay SKU        ${hyphenated.length}   <- eBay accepting a hyphen`);
  console.log(`  our SKU has punctuation, eBay's not  ${stripped.length}   <- the stripped ones`);
  if (hyphenated.length) {
    console.log('    e.g.');
    for (const l of hyphenated.slice(0, 5)) console.log(`      ${pad(l.channelSku, 26)} item ${l.externalListingId ?? '—'}`);
  }
  console.log('');

  // ── 2. are orders for stripped SKUs arriving unrecognised? ───────────────────────────────────
  // An order line keeps the SKU the channel sent and a product when one was found for it.
  // A sales channel names its marketplace rather than linking to the integration, so by name.
  const ebayChannels = await p.salesChannel.findMany({
    where: { name: { contains: 'eBay', mode: 'insensitive' } },
    select: { id: true },
  }).catch(() => []);
  const channelIds = ebayChannels.map((c) => c.id);

  const since = new Date(Date.now() - 90 * 86400000);
  const lines = channelIds.length
    ? await p.salesTransactionItem.findMany({
      where: { transaction: { salesChannelId: { in: channelIds }, date: { gte: since } } },
      select: { sku: true, productId: true },
    }).catch(() => null)
    : [];

  if (lines === null) {
    console.log('  order lines could not be read; question 2 is unanswered');
  } else {
    const products = await p.product.findMany({ select: { id: true, mainSku: true } });
    const byLoose = new Map();
    for (const pr of products) if (/[^a-zA-Z0-9]/.test(pr.mainSku)) byLoose.set(loose(pr.mainSku), pr.mainSku);

    // A line whose SKU is the stripped form of one of ours.
    const strippedLines = lines.filter((l) => !/[^a-zA-Z0-9]/.test(l.sku) && byLoose.has(loose(l.sku)));
    const matched = strippedLines.filter((l) => l.productId);
    const unmatched = strippedLines.filter((l) => !l.productId);

    console.log(`  eBay order lines, last 90 days       ${lines.length}`);
    console.log(`    carrying a stripped SKU            ${strippedLines.length}`);
    console.log(`      recognised as the product        ${matched.length}`);
    console.log(`      NOT recognised                   ${unmatched.length}   <- the real cost`);
    if (unmatched.length) {
      const bySku = {};
      for (const l of unmatched) bySku[l.sku] = (bySku[l.sku] ?? 0) + 1;
      for (const [sku, n] of Object.entries(bySku).slice(0, 10)) {
        console.log(`        ${pad(sku, 20)} x${n}   (ours: ${byLoose.get(loose(sku))})`);
      }
    }
  }

  await p.$disconnect();
  await relinkPreview();
})();

/**
 * What the new order-matching fallback would do, the moment it deploys.
 *
 * The relink pass re-resolves every unlinked order line on every channel, so a looser match is not
 * only about future eBay orders — it reaches back into history, on Amazon and OnBuy as well. That is
 * worth knowing in numbers before it ships rather than after. Uses the compiled rule module itself,
 * so this cannot disagree with what the code will actually do.
 */
async function relinkPreview() {
  const { buildLooseSkuIndex, looseOrderOwner } = require('./.compiled/sku-match.cjs');
  const p = new PrismaClient();

  const products = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const loose = buildLooseSkuIndex(products);
  const exact = new Set();
  for (const pr of products) {
    exact.add(pr.mainSku.trim().toLowerCase());
    for (const a of pr.aliases) exact.add(a.skuValue.trim().toLowerCase());
  }
  const mainOf = new Map(products.map((pr) => [pr.id, pr.mainSku]));

  const unlinked = await p.salesTransactionItem.findMany({
    where: { productId: null, deletedAt: null, transaction: { deletedAt: null, integrationId: { not: null } } },
    select: { sku: true, transaction: { select: { integrationId: true } } },
  });
  const integrationName = new Map(
    (await p.channelIntegration.findMany({ select: { id: true, name: true } })).map((i) => [i.id, i.name]),
  );

  let wouldLink = 0; let ambiguous = 0;
  const bySku = new Map();
  for (const it of unlinked) {
    const sku = (it.sku ?? '').trim();
    if (!sku || exact.has(sku.toLowerCase())) continue; // exact matching already had its chance
    const owner = looseOrderOwner(sku, loose);
    const key = String(sku).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (owner) {
      wouldLink += 1;
      const k = `${sku} -> ${mainOf.get(owner.productId)}`;
      const row = bySku.get(k) ?? { n: 0, channels: new Set() };
      row.n += 1; row.channels.add(integrationName.get(it.transaction?.integrationId) ?? '—');
      bySku.set(k, row);
    } else if (loose.has(key)) {
      ambiguous += 1;
    }
  }

  console.log('');
  console.log('  WHAT THE NEW ORDER FALLBACK WOULD DO ON DEPLOY');
  console.log(`  unlinked order lines, all channels   ${unlinked.length}`);
  console.log(`    would be linked to a product       ${wouldLink}`);
  console.log(`    left alone: two products claim it  ${ambiguous}`);
  for (const [k, row] of [...bySku.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
    console.log(`      ${pad(k, 44)} x${String(row.n).padStart(3)}  ${[...row.channels].join(', ')}`);
  }
  await p.$disconnect();
}

