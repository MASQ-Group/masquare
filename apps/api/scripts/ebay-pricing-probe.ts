/**
 * What the eBay pricing step would show for one product.
 *
 * Read-only. Exercises the whole path — the fee rate measured from settled orders, the competitor
 * search and the margin suggestion — against real data, which is the only way to see whether the
 * measurement has enough orders behind it to be believed.
 *
 * Worth re-running whenever eBay changes its rates or the catalogue grows: it says whether the
 * suggestion is built on this account's own settlements or on a published rate card.
 *
 *   cd apps/api && npx dotenv -e ../../.env -- npx ts-node --transpile-only scripts/ebay-pricing-probe.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EbayListingService } from '../src/listing/ebay/ebay-listing.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const listing = app.get(EbayListingService);

    const integration = await prisma.channelIntegration.findFirst({
      where: { deletedAt: null, channelType: 'ebay', status: 'active' },
      select: { targetCompanyId: true, targetSalesChannelId: true },
    });
    if (!integration?.targetCompanyId) {
      console.log('No active eBay integration with a company.');
      return;
    }
    console.log(`Sales channel linked: ${integration.targetSalesChannelId ?? 'NONE — no orders can be measured'}\n`);

    /** A product with a category, so the whole step is exercised rather than half of it. */
    const plan = await prisma.productChannelPlan.findFirst({
      where: { categoryRef: { not: null }, deletedAt: null, integration: { channelType: 'ebay' } },
      select: { product: { select: { id: true, mainSku: true } } },
    });
    if (!plan) {
      console.log('No product has an eBay category yet.');
      return;
    }

    const p = await listing.pricing(plan.product.id, { companyIds: [integration.targetCompanyId] });
    const money = (c: number) => `${(c / 100).toFixed(2)} ${p.currency}`;

    console.log(`Product     : ${p.sku} — ${p.title}`);
    console.log(`Part number : ${p.manufacturerSku ?? '—'}`);
    console.log(`Cost        : ${p.costCents != null ? money(p.costCents) : 'not recorded'}\n`);

    const a = p.assumptions;
    console.log('FEE RATE');
    console.log(`  ${(a.feePct * 100).toFixed(2)}% + ${money(a.fixedFeeCents)} per order, VAT ${(a.vatRate * 100).toFixed(0)}%`);
    console.log(`  source: ${a.feeSource}${a.feeSource === 'measured' ? ` from ${a.measuredFrom} settled orders` : ''}`);
    if (a.measuredWhyNot) console.log(`  not measured because: ${a.measuredWhyNot}`);

    console.log('\nSUGGESTION');
    if (p.suggestion.ok) {
      const o = p.suggestion.outcome;
      console.log(`  ${money(o.priceCents)} → ${money(o.profitCents)} profit (${o.marginPct}% of net) at a ${p.suggestion.targetMarginPct}% target`);
      console.log(`  ${money(o.priceCents)} − ${money(o.vatCents)} VAT − ${money(o.feesCents)} fees − ${money(o.costCents)} cost`);
    } else {
      console.log(`  none: ${p.suggestion.reason}`);
    }

    console.log('\nCOMPETITORS');
    const c = p.competitors;
    if (!c.available) console.log(`  unavailable: ${c.message}`);
    else {
      console.log(`  searched "${c.searchedFor}" — ${c.matched.length} counted, ${c.rejected.length} set aside`);
      if (c.summary) {
        const cur = c.summary.currency ?? '';
        console.log(`  ${(c.summary.lowestCents / 100).toFixed(2)} – ${(c.summary.highestCents / 100).toFixed(2)} ${cur}, middle ${(c.summary.medianCents / 100).toFixed(2)} ${cur}`);
      }
      // Each offer in ITS OWN currency: eBay returns what each seller charges, in their currency.
      const offerMoney = (cents: number | null, cur: string | null) => (cents == null ? '—' : `${(cents / 100).toFixed(2)} ${cur ?? ''}`.trim());
      for (const o of c.matched.slice(0, 3)) console.log(`    ✓ ${offerMoney(o.priceCents, o.currency)}  ${(o.title ?? '').slice(0, 58)}`);
      for (const r of c.rejected.slice(0, 3)) console.log(`    ✗ ${(r.offer.title ?? '').slice(0, 44)} — ${r.why.slice(0, 60)}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((e: unknown) => {
  console.error((e as Error)?.message ?? e);
  process.exit(1);
});
