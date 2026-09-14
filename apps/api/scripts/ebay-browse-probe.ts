/**
 * Can this eBay account read other sellers' prices?
 *
 * Read-only, and it answers one question: eBay gates the Buy/Browse APIs behind a per-application
 * approval, so "search competing offers" either works for this keyset or is refused outright. The
 * eBay listing flow's pricing step depends on the answer, and guessing it would mean designing a
 * screen around data that may never arrive.
 *
 * Boots the API's own modules so it uses the real integration and its stored token — no credentials
 * are read, printed or handled here.
 *
 *   cd apps/api && npx dotenv -e ../../.env -- npx ts-node scripts/ebay-browse-probe.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { IntegrationsService } from '../src/integrations/integrations.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const integrations = app.get(IntegrationsService);

    const row = await prisma.channelIntegration.findFirst({
      where: { deletedAt: null, channelType: 'ebay', status: 'active' },
      select: { id: true, marketplace: true },
    });
    if (!row) {
      console.log('No active eBay integration in this database.');
      return;
    }

    console.log(`Marketplace : EBAY_${(row.marketplace ?? 'GB').toUpperCase()}\n`);

    /**
     * Several barcodes, not one. A single empty result cannot tell "the API is available but nobody
     * else lists this" apart from "barcode search does not match anything on eBay" — and those lead
     * to completely different designs for the pricing step.
     */
    const products = await prisma.product.findMany({
      where: { deletedAt: null, ean: { not: null } },
      select: { mainSku: true, ean: true, title: true },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    });
    if (products.length === 0) {
      console.log('No product with an EAN to search on.');
      return;
    }

    let matched = 0;
    for (const p of products) {
      const res = await integrations.ebayCompetingOffers(row.id, p.ean as string, { limit: 10 });

      if (!res.ok && !res.available) {
        console.log('RESULT: the Buy/Browse API is NOT available to this application.');
        console.log(`eBay said: ${res.message}`);
        console.log('\nCompetitor prices cannot be read until eBay grants Buy API access to the keyset.');
        return;
      }
      if (!res.ok) {
        console.log(`${p.ean}  ${p.mainSku.padEnd(22)} request failed — ${res.message}`);
        continue;
      }

      if (res.offers.length > 0) matched += 1;
      const prices = res.offers
        .map((o) => o.priceCents)
        .filter((c): c is number => c != null)
        .sort((a, b) => a - b);
      const range = prices.length
        ? `${(prices[0] / 100).toFixed(2)}–${(prices[prices.length - 1] / 100).toFixed(2)} ${res.offers[0].currency ?? ''}`
        : '—';

      console.log(`${p.ean}  ${p.mainSku.padEnd(22)} ${String(res.offers.length).padStart(2)} offers  ${range.padEnd(22)} ${(p.title ?? '').slice(0, 42)}`);
      for (const o of res.offers.slice(0, 3)) {
        const price = o.priceCents != null ? `${(o.priceCents / 100).toFixed(2)} ${o.currency ?? ''}`.trim() : '—';
        console.log(`    ${price.padEnd(12)} ${(o.condition ?? '').padEnd(12)} ${(o.title ?? '').slice(0, 56)}`);
      }
    }

    console.log(`\nBarcode search: ${matched} of ${products.length} matched live listings.`);

    /**
     * The control. If words find listings where the barcode found none, eBay's catalogue simply does
     * not carry these barcodes — which is a fact about eBay, not about our data, and it decides
     * whether a barcode-only pricing step can work at all.
     */
    const sample = products.find((p) => (p.ean ?? '').trim());
    if (sample) {
      const words = (sample.title ?? '').split(/\s+/).slice(0, 4).join(' ');
      const byWords = await integrations.ebayCompetingOffers(row.id, '', { query: words, limit: 10 });
      console.log(`\nControl — same product searched by words ("${words}"):`);
      if (!byWords.ok) console.log(`  failed — ${byWords.message}`);
      else {
        console.log(`  ${byWords.offers.length} offers`);
        for (const o of byWords.offers.slice(0, 5)) {
          const price = o.priceCents != null ? `${(o.priceCents / 100).toFixed(2)} ${o.currency ?? ''}`.trim() : '—';
          console.log(`    ${price.padEnd(12)} ${(o.title ?? '').slice(0, 62)}`);
        }
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((e: unknown) => {
  console.error((e as Error)?.message ?? e);
  process.exit(1);
});
