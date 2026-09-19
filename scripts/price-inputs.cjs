/**
 * The inputs every suggested-price screen reads for one product, side by side.
 *
 *   SKU=IT33248 REPORT=price-inputs bash scripts/prod-scan.sh
 *
 * Read-only. Written when eBay UK and OnBuy UK suggested different prices for the same 20% target:
 * shows the product's cost and weight, each channel connection's linked sales channel with its fee
 * and VAT rules, the default shipping service into that channel's country, and the prices the
 * plans hold — so a difference can be traced to an input rather than guessed at.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const sku = (process.env.SKU || '').trim();
  if (!sku) { console.log('Set SKU=… to name the product.'); return; }
  const p = new PrismaClient();
  const product = await p.product.findFirst({
    where: { mainSku: sku, deletedAt: null },
    select: {
      id: true, mainSku: true, purchaseCostAmount: true, purchaseCostCurrency: true, averageCostEur: true,
      packageWeightKg: true, productWeightKg: true, packageLengthCm: true, packageWidthCm: true, packageHeightCm: true,
    },
  });
  if (!product) { console.log(`No product with SKU ${sku}.`); await p.$disconnect(); return; }
  const n = (v) => (v == null ? '—' : Number(v));
  console.log(`${product.mainSku}: purchaseCost=${n(product.purchaseCostAmount)} ${product.purchaseCostCurrency ?? ''} averageCostEur=${n(product.averageCostEur)}`);
  console.log(`  weight package=${n(product.packageWeightKg)}kg product=${n(product.productWeightKg)}kg dims=${n(product.packageLengthCm)}×${n(product.packageWidthCm)}×${n(product.packageHeightCm)}cm`);

  const integrations = await p.channelIntegration.findMany({
    where: { deletedAt: null, channelType: { in: ['ebay', 'onbuy'] } },
    select: { id: true, name: true, channelType: true, marketplace: true, targetSalesChannelId: true },
  });
  for (const i of integrations) {
    console.log(`\n${i.channelType} ${i.name} market=${JSON.stringify(i.marketplace)}`);
    const plan = await p.productChannelPlan.findFirst({
      where: { productId: product.id, integrationId: i.id, deletedAt: null },
      select: { status: true, offerPriceCents: true, marketplace: true },
    });
    console.log(`  plan: ${plan ? `${plan.status} market=${JSON.stringify(plan.marketplace)} offerPrice=${plan.offerPriceCents ?? '—'}` : 'none'}`);
    if (!i.targetSalesChannelId) { console.log('  linked sales channel: none'); continue; }
    const c = await p.salesChannel.findFirst({
      where: { id: i.targetSalesChannelId },
      select: {
        name: true, nativeCurrency: true, generalSalesFeePct: true, pricesIncludeTax: true,
        vatThresholdEnabled: true, vatThresholdAmount: true, vatBelowThresholdPct: true, vatAboveThresholdPct: true,
        nativeCountry: { select: { isoCode: true, vatRate: true, defaultShippingServiceId: true } },
      },
    });
    if (!c) { console.log('  linked sales channel: missing'); continue; }
    console.log(`  linked sales channel: ${c.name} ${c.nativeCurrency} fee=${n(c.generalSalesFeePct)}% pricesIncludeTax=${c.pricesIncludeTax}`);
    console.log(`  VAT: country ${c.nativeCountry?.isoCode} ${n(c.nativeCountry?.vatRate)}%; threshold ${c.vatThresholdEnabled ? `${n(c.vatThresholdAmount)} below=${n(c.vatBelowThresholdPct)}% above=${n(c.vatAboveThresholdPct)}%` : 'off'}`);
    const svcId = c.nativeCountry?.defaultShippingServiceId;
    const svc = svcId ? await p.shippingService.findFirst({ where: { id: svcId }, select: { name: true, calcMethod: true } }) : null;
    console.log(`  default shipping service: ${svc ? `${svc.name} (${svc.calcMethod})` : 'none'}`);
    if (svcId) {
      const zones = await p.shippingZone.findMany({
        where: { shippingServiceId: svcId, deletedAt: null, countries: { some: { country: { isoCode: c.nativeCountry.isoCode } } } },
        select: { name: true, rates: { where: { deletedAt: null }, select: { fromWeightKg: true, toWeightKg: true, chargeEur: true }, orderBy: { fromWeightKg: 'asc' } } },
      });
      for (const z of zones) {
        const bands = z.rates.filter((r) => Number(r.toWeightKg) >= 7 && Number(r.fromWeightKg) <= 10);
        console.log(`  zone ${z.name}: ${bands.map((r) => `${n(r.fromWeightKg)}–${n(r.toWeightKg)}kg €${n(r.chargeEur)}`).join(', ')}`);
      }
    }
  }
  await p.$disconnect();
})();
