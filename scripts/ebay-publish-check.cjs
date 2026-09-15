/**
 * Why eBay refused to publish one product: what we hold for it, and whether eBay already has it.
 *
 *   REPORT=ebay-publish-check bash scripts/prod-scan.sh
 *
 * "Cannot revise listing" on a PUBLISH means eBay treated the offer as a change to a listing that
 * already exists — so the first question is whether this SKU is already live on eBay, from another
 * tool or an earlier attempt. The second is whether the words we sent trip eBay's filters. Reads only;
 * prints SKUs, titles and our own copy, no customer data.
 */
const { PrismaClient } = require('@prisma/client');

const SKU = 'LAG-611474';

(async () => {
  const p = new PrismaClient();
  const product = await p.product.findFirst({
    where: { mainSku: SKU, deletedAt: null },
    select: {
      id: true, mainSku: true, title: true, ebayTitle: true, manufacturerSku: true, ean: true,
      descriptionHtml: true, keyFeatures: true, brand: { select: { name: true } },
      aliases: { select: { skuValue: true } },
    },
  });
  if (!product) { console.log(`No product ${SKU}`); await p.$disconnect(); return; }
  const safe = (s) => s.replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);
  const skus = [product.mainSku, ...product.aliases.map((a) => a.skuValue)];
  console.log(`PRODUCT ${product.mainSku}  (eBay SKU sent: ${safe(product.mainSku)})`);
  console.log(`  brand ${product.brand?.name ?? '—'} · MPN ${product.manufacturerSku ?? '—'} · EAN ${product.ean ?? '—'}`);
  console.log(`  title      ${product.title}`);
  console.log(`  eBay title ${product.ebayTitle ?? '—'}`);
  console.log(`  aliases    ${product.aliases.map((a) => a.skuValue).join(', ') || '—'}`);

  const ebay = await p.channelIntegration.findMany({ where: { channelType: 'ebay' }, select: { id: true } });
  const ids = ebay.map((e) => e.id);
  const listings = await p.channelListing.findMany({
    where: {
      integrationId: { in: ids },
      OR: [{ productId: product.id }, { channelSku: { in: [...skus, ...skus.map(safe)] } }],
    },
    select: { channelSku: true, marketplace: true, externalListingId: true, listedQuantity: true, listingStatus: true, title: true, lastPulledAt: true },
  });
  console.log(`\nALREADY ON EBAY (from our last pull): ${listings.length} listing(s)`);
  for (const l of listings) {
    console.log(`  [${l.marketplace || '?'}] sku ${l.channelSku} · item ${l.externalListingId ?? '—'} · qty ${l.listedQuantity ?? '—'} · ${l.listingStatus ?? '—'} · pulled ${l.lastPulledAt ? l.lastPulledAt.toISOString().slice(0, 10) : 'never'}`);
    console.log(`       "${(l.title ?? '').slice(0, 90)}"`);
  }

  const plan = await p.productChannelPlan.findFirst({
    where: { productId: product.id, integrationId: { in: ids } },
    select: { categoryRef: true, categoryName: true, status: true, externalListingId: true, descriptionExtras: true },
  });
  console.log(`\nPLAN category ${plan?.categoryRef ?? '—'} ${plan?.categoryName ?? ''} · status ${plan?.status ?? '—'} · listing ${plan?.externalListingId ?? '—'}`);

  const text = (product.descriptionHtml ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const x = plan?.descriptionExtras ?? {};
  console.log('\nWORDS WE SEND');
  console.log(`  description (${text.length} chars): ${text.slice(0, 600)}`);
  console.log(`  features: ${(product.keyFeatures ?? []).join(' | ')}`);
  for (const k of ['series', 'inTheBox', 'care']) if (x[k]) console.log(`  ${k}: ${x[k]}`);
  for (const f of x.faq ?? []) console.log(`  faq: ${f.q} — ${f.a}`);

  // Words eBay's filters commonly act on in titles and descriptions.
  const all = [product.ebayTitle, product.title, text, ...(product.keyFeatures ?? []), x.series, x.inTheBox, x.care, ...(x.faq ?? []).flatMap((f) => [f.q, f.a])].filter(Boolean).join(' ');
  const flags = ['replica', 'fake', 'copy', 'inspired', 'style of', 'compatible with', 'like ', 'counterfeit', 'unbranded', 'oem', 'bootleg', 'knock', 'http', 'www', '@', 'paypal', 'western union', 'bank transfer', 'call ', 'whatsapp', 'email', 'not ', 'cheap'];
  const hits = flags.filter((w) => all.toLowerCase().includes(w));
  console.log(`\nWORDS THAT OFTEN TRIP EBAY FILTERS: ${hits.length ? hits.join(', ') : 'none found'}`);
  await p.$disconnect();
})();
