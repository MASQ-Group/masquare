/**
 * What could a gather actually read, for the products we hold?
 *
 *   REPORT=gather-sources bash scripts/prod-scan.sh
 *
 * Decides which source adapter is worth building first. The manufacturer's own datasheet is the
 * authoritative source, but "authoritative" is worth nothing if no product carries one — and the
 * two-source fallback is worth nothing if only one source can be reached. Reads only.
 */
const { PrismaClient } = require('@prisma/client');

const DOC_HINT = /(datasheet|data[-_ ]?sheet|spec|specification|manual|instruction|technical|tds|leaflet)/i;
const PDF = /\.pdf(\?|$)/i;

(async () => {
  const p = new PrismaClient();

  const products = await p.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true, mainSku: true, manufacturerSku: true, ean: true, upc: true,
      brandId: true, brand: { select: { name: true, website: true } },
      documents: { where: { deletedAt: null }, select: { name: true, url: true } },
    },
  });

  const total = products.length;
  const has = (x) => !!(x && String(x).trim());

  /**
   * The refusal rule, applied here exactly as the engine will apply it: a gather without a
   * manufacturer SKU or an EAN/UPC has nothing precise enough to search on.
   */
  const eligible = products.filter((x) => has(x.manufacturerSku) && (has(x.ean) || has(x.upc)));
  const noMpn = products.filter((x) => !has(x.manufacturerSku));
  const noGtin = products.filter((x) => !has(x.ean) && !has(x.upc));

  const withDocs = products.filter((x) => x.documents.length > 0);
  const withDatasheet = products.filter((x) =>
    x.documents.some((d) => PDF.test(d.url) && DOC_HINT.test(d.name)));
  const withAnyPdf = products.filter((x) => x.documents.some((d) => PDF.test(d.url)));

  const brands = await p.brand.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, website: true },
  });
  const brandSite = new Map(brands.map((b) => [b.id, b.website]));
  const withBrandSite = products.filter((x) => has(brandSite.get(x.brandId)));

  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  const line = (label, n) => console.log(`  ${label.padEnd(46)} ${String(n).padStart(6)}  ${pct(n)}`);

  console.log(`\nProducts (not deleted): ${total}\n`);

  console.log('CAN A GATHER RUN AT ALL');
  line('has manufacturer SKU AND EAN/UPC', eligible.length);
  line('  refused — no manufacturer SKU', noMpn.length);
  line('  refused — no EAN and no UPC', noGtin.length);

  console.log('\nAUTHORITATIVE SOURCE — what we already hold');
  line('has any document attached', withDocs.length);
  line('  of those, a PDF', withAnyPdf.length);
  line('  a PDF that reads like a datasheet/manual', withDatasheet.length);
  line('brand has a website recorded', withBrandSite.length);

  console.log(`\nbrands: ${brands.length}, of which ${brands.filter((b) => has(b.website)).length} carry a website`);

  /**
   * The intersection is the one that matters: a product the gather would accept AND has something
   * authoritative to read. Everything outside it falls to the two-source rule, and with only one
   * marketplace reachable that means "suggestion, held back" rather than an answer.
   */
  const bothIds = new Set(withDatasheet.map((x) => x.id));
  const sweet = eligible.filter((x) => bothIds.has(x.id));
  console.log(`\neligible AND carrying a datasheet PDF: ${sweet.length}  ${pct(sweet.length)}`);

  const sitesIds = new Set(withBrandSite.map((x) => x.id));
  console.log(`eligible AND brand website known:        ${eligible.filter((x) => sitesIds.has(x.id)).length}`);

  console.log('\nTop brands by eligible product count (website shown if recorded):');
  const byBrand = new Map();
  for (const x of eligible) {
    const k = x.brand?.name ?? '—';
    const e = byBrand.get(k) ?? { n: 0, site: x.brand?.website ?? null };
    e.n += 1;
    byBrand.set(k, e);
  }
  [...byBrand.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15)
    .forEach(([name, e]) => console.log(`  ${String(e.n).padStart(5)}  ${name.padEnd(24)} ${e.site ?? '(no website)'}`));

  const docSample = withDatasheet.slice(0, 8);
  if (docSample.length) {
    console.log('\nSample of documents that look like datasheets:');
    for (const x of docSample) {
      const d = x.documents.find((d) => PDF.test(d.url) && DOC_HINT.test(d.name));
      console.log(`  ${x.mainSku.padEnd(20)} ${d.name}`);
    }
  }

  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
