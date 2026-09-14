/**
 * Twenty real products to probe, spread across brands rather than clustered.
 *
 *   REPORT=probe-sample bash scripts/prod-scan.sh
 *
 * One per brand, taken from the brands that carry the most products, so the hit rate measured is a
 * hit rate per BRAND SITE — which is what actually varies. Twenty products of one brand would
 * measure one website twice over. Reads only.
 */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const rows = await p.product.findMany({
    where: { deletedAt: null, brandId: { not: null }, manufacturerSku: { not: null } },
    select: { mainSku: true, title: true, manufacturerSku: true, ean: true, upc: true,
      brand: { select: { name: true } } },
  });
  const byBrand = new Map();
  for (const r of rows) {
    const b = r.brand?.name ?? '—';
    if (!byBrand.has(b)) byBrand.set(b, []);
    byBrand.get(b).push(r);
  }
  const ranked = [...byBrand.entries()].sort((a, c) => c[1].length - a[1].length);
  console.log(`\n  ${rows.length} products carry both a brand and a manufacturer SKU, across ${ranked.length} brands\n`);
  console.log(`  one product from each of the twenty largest brands\n`);
  let n = 0;
  for (const [brand, list] of ranked.slice(0, 20)) {
    /** Prefer one WITH an identifier — the refusal rule makes the others un-probeable anyway. */
    const pick = list.find((x) => x.ean || x.upc) ?? list[0];
    n += 1;
    console.log(`  ${String(n).padStart(2)}. ${brand.padEnd(18)} ${String(pick.manufacturerSku).padEnd(20)} ean=${pick.ean ?? '—'}`);
    console.log(`      ${pick.mainSku.padEnd(20)} ${pick.title.slice(0, 72)}`);
  }

  const noId = rows.filter((r) => !r.ean && !r.upc).length;
  console.log(`\n  of all ${rows.length}: ${noId} have no EAN or UPC — the refusal rule blocks those outright`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
