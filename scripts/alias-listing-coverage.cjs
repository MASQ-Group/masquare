/**
 * Do listings that use an ALIAS sku get matched to their product, and therefore receive stock?
 *
 *   REPORT=alias-listing-coverage bash scripts/prod-scan.sh
 *
 * Availability hangs off the product, and the push selects listings by productId. So an alias-SKU
 * listing is reached if — and only if — the listings sync managed to match it. This counts that.
 */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const aliases = await p.productSkuAlias.findMany({
    where: { deletedAt: null },
    select: { skuValue: true, productId: true, fulfilmentType: { select: { code: true, name: true } } },
  });
  const byAlias = new Map(aliases.map((a) => [a.skuValue.trim().toLowerCase(), a]));
  const mains = new Map((await p.product.findMany({ where: { deletedAt: null }, select: { id: true, mainSku: true } }))
    .map((x) => [x.mainSku.trim().toLowerCase(), x.id]));

  const rows = await p.channelListing.findMany({
    select: { channelSku: true, productId: true, fulfilmentChannel: true, listedQuantity: true,
      integration: { select: { name: true } } },
  });

  let aliasRows = 0, aliasMatched = 0, aliasUnmatched = 0, aliasFba = 0;
  let mainRows = 0, unknownSku = 0;
  const unmatchedAliasEx = [];
  for (const r of rows) {
    const k = r.channelSku.trim().toLowerCase();
    if (byAlias.has(k)) {
      aliasRows += 1;
      if (r.fulfilmentChannel === 'FBA') aliasFba += 1;
      if (r.productId) aliasMatched += 1;
      else { aliasUnmatched += 1; if (unmatchedAliasEx.length < 8) unmatchedAliasEx.push(`${r.channelSku} on ${r.integration.name}`); }
    } else if (mains.has(k)) mainRows += 1;
    else unknownSku += 1;
  }

  console.log(`  listing rows                                    ${rows.length}`);
  console.log(`    using a product's MAIN sku                    ${mainRows}`);
  console.log(`    using a defined ALIAS sku                     ${aliasRows}`);
  console.log(`      of those, matched to the product            ${aliasMatched}`);
  console.log(`      of those, NOT matched (never pushed)        ${aliasUnmatched}`);
  console.log(`      of those, FBA (correctly not pushed)        ${aliasFba}`);
  console.log(`    sku is neither a main sku nor a known alias   ${unknownSku}   <- invisible to the push\n`);
  if (unmatchedAliasEx.length) { console.log('  unmatched alias rows:'); for (const s of unmatchedAliasEx) console.log('    ' + s); }

  const noFulfil = aliases.filter((a) => !a.fulfilmentType);
  console.log(`\n  aliases defined: ${aliases.length}; with no fulfilment type set: ${noFulfil.length}`);
  for (const a of noFulfil.slice(0, 6)) console.log(`    ${a.skuValue}`);
  await p.$disconnect();
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
