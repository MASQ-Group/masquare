/**
 * What the eBay Publish button will do, product by product, once the duplicate guard ships.
 *
 *   REPORT=ebay-publish-identity bash scripts/prod-scan.sh
 *
 * Publishing used to create a listing whatever eBay already held, so a product listed by hand got a
 * second listing, and one of the twenty stripped-SKU listings would have got one too. The new rule
 * decides first: create, update the listing we made, or refuse. This runs that same rule — the
 * compiled module, not a copy — over every product with an eBay UK plan or listing, so the change is
 * known in numbers before anybody meets it on a product page.
 *
 * Read-only.
 */
const { PrismaClient } = require('@prisma/client');
const { publishIdentity } = require('./.compiled/publish-identity.cjs');

(async () => {
  const p = new PrismaClient();
  const ebay = await p.channelIntegration.findMany({ where: { channelType: 'ebay' }, select: { id: true } });
  const ids = ebay.map((i) => i.id);

  // By product link AND by SKU, as the service now does: a stripped listing may not be linked.
  const allProducts = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const ownerOfForm = new Map();
  for (const pr of allProducts) {
    const forms = [pr.mainSku, pr.mainSku.replace(/[^a-zA-Z0-9]/g, '').slice(0, 50), ...pr.aliases.map((a) => a.skuValue)];
    for (const f of forms) if (!ownerOfForm.has(f)) ownerOfForm.set(f, pr.id);
  }
  const rawListings = await p.channelListing.findMany({
    where: { integrationId: { in: ids }, marketplace: { in: ['GB', ''] } },
    select: { productId: true, channelSku: true, externalListingId: true },
  });
  const listings = rawListings
    .map((l) => ({ ...l, productId: l.productId ?? ownerOfForm.get(l.channelSku) ?? null }))
    .filter((l) => l.productId);
  const plans = await p.productChannelPlan.findMany({
    where: { integrationId: { in: ids }, deletedAt: null },
    select: { productId: true, status: true, channelSku: true, externalListingId: true },
  });

  const byProduct = new Map();
  for (const l of listings) {
    const e = byProduct.get(l.productId) ?? { existing: [], plan: null };
    e.existing.push({ channelSku: l.channelSku, itemId: l.externalListingId });
    byProduct.set(l.productId, e);
  }
  for (const pl of plans) {
    const e = byProduct.get(pl.productId) ?? { existing: [], plan: null };
    e.plan = pl;
    byProduct.set(pl.productId, e);
  }

  const products = await p.product.findMany({
    where: { id: { in: [...byProduct.keys()] } },
    select: { id: true, mainSku: true },
  });
  const skuOf = new Map(products.map((pr) => [pr.id, pr.mainSku]));

  const counts = { create: 0, update: 0, adopted: 0, refuse: 0 };
  const adopted = [];
  for (const [productId, e] of byProduct) {
    const mainSku = skuOf.get(productId);
    if (!mainSku) continue;
    const r = publishIdentity({ mainSku, plan: e.plan, existing: e.existing });
    if (r.action === 'update' && r.adopted) { counts.adopted += 1; adopted.push(`${mainSku} -> ${r.sku} (item ${r.itemId})`); }
    else counts[r.action] += 1;
  }

  console.log(`  products with an eBay UK plan or listing   ${byProduct.size}`);
  console.log(`    Publish would CREATE a first listing      ${counts.create}`);
  console.log(`    Publish would UPDATE the one we recorded  ${counts.update}`);
  console.log(`    Publish would ADOPT a stripped listing    ${counts.adopted}   <- ours, published stripped: updated, not duplicated`);
  console.log(`    Publish would REFUSE — already on eBay    ${counts.refuse}   <- each was one click from a duplicate`);
  for (const a of adopted.slice(0, 25)) console.log(`      ${a}`);

  await p.$disconnect();
  await strippedDetail();
})();

/**
 * The twenty stripped listings, looked at one by one: why none was adoptable.
 *
 * Adoption needs the stripped listing to be the ONLY eBay UK listing of its product. If it is not,
 * the product is on eBay UK twice — which is a duplicate already live, not a hypothetical one.
 */
async function strippedDetail() {
  const p = new PrismaClient();
  const ebay = await p.channelIntegration.findMany({ where: { channelType: 'ebay' }, select: { id: true } });
  const ids = ebay.map((i) => i.id);
  const loose = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const all = await p.channelListing.findMany({
    where: { integrationId: { in: ids }, productId: { not: null } },
    select: { productId: true, channelSku: true, marketplace: true, externalListingId: true, listedQuantity: true,
      product: { select: { mainSku: true } } },
  });
  const strippedRows = all.filter((l) => l.product?.mainSku && /[^a-zA-Z0-9]/.test(l.product.mainSku)
    && l.channelSku !== l.product.mainSku && loose(l.channelSku) === loose(l.product.mainSku)
    && !/[^a-zA-Z0-9]/.test(l.channelSku));

  // The same search, but not relying on the sync having linked the row to a product: a stripped SKU
  // is exactly the kind of row that might not have been linked, and the whole question is whether
  // our code's publishes are on eBay at all.
  const punctuated = await p.product.findMany({ where: { deletedAt: null }, select: { mainSku: true } });
  const strippedForms = new Map();
  for (const pr of punctuated) {
    if (!/[^a-zA-Z0-9]/.test(pr.mainSku)) continue;
    strippedForms.set(pr.mainSku.replace(/[^a-zA-Z0-9]/g, '').slice(0, 50), pr.mainSku);
  }
  const anyStripped = await p.channelListing.findMany({
    where: { integrationId: { in: ids }, channelSku: { in: [...strippedForms.keys()] } },
    select: { channelSku: true, marketplace: true, productId: true, externalListingId: true },
  });
  const lastRun = await p.channelIntegration.findMany({
    where: { id: { in: ids } }, select: { name: true, lastSyncRunAt: true },
  });
  console.log('');
  console.log(`  eBay listings whose SKU is one of ours with its punctuation stripped: ${anyStripped.length}`);
  for (const l of anyStripped) {
    console.log(`    ${l.channelSku.padEnd(20)} (ours: ${strippedForms.get(l.channelSku)})  ${l.marketplace || '(none)'}  item ${l.externalListingId ?? '—'}  ${l.productId ? 'linked' : 'NOT linked'}`);
  }
  for (const r of lastRun) console.log(`  ${r.name} last sync run: ${r.lastSyncRunAt ? r.lastSyncRunAt.toISOString().slice(0, 16) : '—'}`);

  const products = [...new Set(strippedRows.map((l) => l.productId))];
  console.log('');
  console.log(`  STRIPPED LISTINGS: ${strippedRows.length} rows across ${products.length} products`);
  let duplicated = 0;
  for (const pid of products) {
    const rows = all.filter((l) => l.productId === pid);
    const gb = rows.filter((l) => l.marketplace === 'GB' || l.marketplace === '');
    const ukItems = new Set(gb.map((l) => l.externalListingId));
    if (ukItems.size > 1) duplicated += 1;
    console.log(`    ${String(rows[0].product.mainSku).padEnd(20)} UK listings: ${ukItems.size}${ukItems.size > 1 ? '  <- ON eBay UK MORE THAN ONCE' : ''}`);
    for (const l of rows) {
      console.log(`        ${String(l.marketplace || '(unresolved)').padEnd(12)} ${String(l.channelSku).padEnd(22)} item ${l.externalListingId ?? '—'}  qty ${l.listedQuantity ?? '—'}`);
    }
  }
  console.log(`  products on eBay UK more than once         ${duplicated}`);
  await p.$disconnect();
}
