/**
 * Does the handover data fit the platform, and what would it collide with?
 *
 *   REPORT=handover-fit bash scripts/prod-scan.sh
 *
 * Step 1 of the task brief: establish the access path and STOP. This answers the questions it
 * says to answer, against production, without writing anything.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const DIR = 'Product Listings Data/handover';

(async () => {
  const p = new PrismaClient();
  const content = JSON.parse(fs.readFileSync(`${DIR}/masquare-product-content.json`, 'utf8')).products;
  const assign = JSON.parse(fs.readFileSync(`${DIR}/masquare-product-assignments.json`, 'utf8')).assignments;
  const tax = JSON.parse(fs.readFileSync(`${DIR}/masquare-taxonomy.json`, 'utf8'));

  const skus = content.map((c) => c.sku);
  const products = [];
  for (let i = 0; i < skus.length; i += 500) {
    products.push(...await p.product.findMany({
      where: { mainSku: { in: skus.slice(i, i + 500) }, deletedAt: null },
      select: { id: true, mainSku: true, title: true, ebayTitle: true, shortDescription: true,
        descriptionHtml: true, keyFeatures: true, categoryId: true, productTypeId: true },
    }));
  }
  const bySku = new Map(products.map((x) => [x.mainSku, x]));

  console.log(`\n  ── matching ──\n`);
  console.log(`    SKUs in the handover            ${skus.length}`);
  console.log(`    found on the platform           ${products.length}`);
  console.log(`    NOT found                       ${skus.length - products.length}`);
  const missing = skus.filter((s) => !bySku.has(s));
  for (const s of missing.slice(0, 12)) console.log(`        ${s}`);
  if (missing.length > 12) console.log(`        …and ${missing.length - 12} more`);

  /** Which incoming fields would overwrite existing copy, and which are empty against existing. */
  const FIELDS = [
    ['product_title', 'title'],
    ['ebay_title', 'ebayTitle'],
    ['short_description', 'shortDescription'],
    ['long_description', 'descriptionHtml'],
    ['key_features', 'keyFeatures'],
  ];
  const stat = Object.fromEntries(FIELDS.map(([k]) => [k, { write: 0, overwrite: 0, emptyIncoming: 0, collision: 0 }]));
  const has = (v) => Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());

  for (const c of content) {
    const row = bySku.get(c.sku);
    if (!row) continue;
    for (const [inKey, col] of FIELDS) {
      const incoming = c[inKey];
      const existing = row[col];
      if (has(incoming)) { stat[inKey].write += 1; if (has(existing)) stat[inKey].overwrite += 1; }
      else { stat[inKey].emptyIncoming += 1; if (has(existing)) stat[inKey].collision += 1; }
    }
  }
  console.log(`\n  ── what the content write would do (matched products only) ──\n`);
  console.log(`    ${'field'.padEnd(20)} ${'write'.padStart(6)} ${'overwrites'.padStart(11)} ${'empty in'.padStart(9)} ${'COLLISION'.padStart(10)}`);
  for (const [k] of FIELDS) {
    const s = stat[k];
    console.log(`    ${k.padEnd(20)} ${String(s.write).padStart(6)} ${String(s.overwrite).padStart(11)} ${String(s.emptyIncoming).padStart(9)} ${String(s.collision).padStart(10)}`);
  }
  console.log(`\n    COLLISION = incoming empty, platform has content. The brief says report, never blank.`);

  console.log(`\n  ── taxonomy ──\n`);
  const [cats, types] = await Promise.all([
    p.productCategory.count({ where: { deletedAt: null } }),
    p.productType.count({ where: { deletedAt: null } }),
  ]);
  console.log(`    categories on the platform now  ${cats}    handover wants ${tax.categories.length}`);
  console.log(`    product types now               ${types}    handover wants ${tax.product_types.length}`);
  const withPath = await p.productCategory.count({ where: { deletedAt: null, path: { not: null } } });
  const typeSlugs = await p.productType.count({ where: { deletedAt: null, slug: { not: null } } });
  console.log(`    categories already carrying a path  ${withPath}`);
  console.log(`    product types already carrying a slug ${typeSlugs}`);

  const assigned = products.filter((x) => x.categoryId).length;
  const typed = products.filter((x) => x.productTypeId).length;
  console.log(`\n    matched products already having a category  ${assigned}`);
  console.log(`    matched products already having a type      ${typed}`);
  console.log(`    assignments supplied                        ${assign.length}`);
  /**
   * Do the unmatched SKUs exist under a different spelling?
   *
   * `BE-BF600 WHITE` was one of the punctuation variants the relink claimed in #12 — the catalogue
   * holds `BE-BF600WHITE`. A handover that matches strictly on `sku` would create a second product
   * for a separator, so the answer matters before anything is written.
   */
  const { buildLooseSkuIndex, buildSkuOwnerIndex, matchSku } = require('./.compiled/sku-match.cjs');
  const all = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
  });
  const idx = buildSkuOwnerIndex(all);
  const loose = buildLooseSkuIndex(all);
  console.log(`
  ── the unmatched SKUs, asked loosely ──
`);
  for (const sku of missing) {
    const m = matchSku(sku, idx, loose);
    console.log(`    ${sku.padEnd(24)} ${m.owner ? `${m.how.padEnd(12)} -> ${m.owner.sku}` : 'genuinely not in the catalogue'}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
