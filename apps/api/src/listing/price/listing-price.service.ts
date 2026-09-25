import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { PricingService } from '../../pricing/pricing.service';
import { profitEntry } from './listing-price';

/** The listing a price change is about, named the way a listing card names it. */
export interface ListingPriceTarget {
  productId: string;
  integrationId: string;
  /** Our SKU on the channel. */
  sku?: string | null;
  /** The market, for eBay — one account lists in many. */
  countryIso?: string | null;
}

/** eBay markets are stored under ISO codes, except the UK, which some rows carry as "UK". */
const MARKET_ALIASES: Record<string, string[]> = { GB: ['GB', 'UK'], UK: ['GB', 'UK'] };

/**
 * Changing the price of a live eBay or OnBuy listing, with what the price earns beside it.
 *
 * The same answers Amazon's price check and update give — same shape, same gate — so one Edit price
 * window serves all three channels. Amazon keeps its own service because its fees come from Amazon's
 * live fee estimate; eBay and OnBuy are costed by the platform's own model for the channel, the one
 * behind every other profit figure on screen.
 *
 * How the price reaches the channel:
 *   OnBuy   PUT /v2/listings/by-sku, price only.
 *   Jinius  Mirakl OF24 POST /api/offers, keyed on our own shop SKU, price only — Mirakl queues the
 *           write and applies it after answering, so the push waits briefly for its import report.
 *   eBay    a listing this platform published is an Inventory API offer, changed through eBay's bulk
 *           price call (eBay refuses Trading-API revisions of those); any other eBay listing — made
 *           on eBay, or by eBaymag — through ReviseInventoryStatus, the call the stock push uses.
 */
@Injectable()
export class ListingPriceService {
  private readonly logger = new Logger(ListingPriceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly prices: PricingService,
  ) {}

  /** The same gate Amazon's price edits use: "Change listing prices" in Global settings. */
  async priceWritesEnabled(): Promise<boolean> {
    if (process.env.CHANNEL_PRICE_WRITES === 'false') return false;
    const settings = await this.prisma.platformSettings.findFirst({ select: { channelPriceWrites: true } });
    return settings?.channelPriceWrites ?? false;
  }

  private async resolve(t: ListingPriceTarget, companyIds?: string[]) {
    const integration = await this.prisma.channelIntegration.findFirst({
      where: {
        id: t.integrationId, deletedAt: null, channelType: { in: ['ebay', 'onbuy', 'jinius'] },
        ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
      },
      select: { id: true, name: true, channelType: true, marketplace: true, targetCompanyId: true, targetSalesChannelId: true },
    });
    if (!integration) throw new NotFoundException('Channel not found');

    const iso = (t.countryIso ?? '').toUpperCase() || null;
    const markets = iso ? MARKET_ALIASES[iso] ?? [iso] : null;
    const listing = await this.prisma.channelListing.findFirst({
      where: {
        productId: t.productId,
        integrationId: integration.id,
        ...(t.sku ? { channelSku: t.sku } : {}),
        ...(integration.channelType === 'ebay' && markets ? { marketplace: { in: markets } } : {}),
      },
      select: { id: true, channelSku: true, listedPrice: true, currency: true, marketplace: true, externalListingId: true },
    });
    if (!listing) throw new BadRequestException('This product is not listed on that channel, so there is no price to change.');

    // The sales channel this listing sells through, for its fee, VAT and currency: the connection's
    // own for OnBuy; for eBay, the company's eBay channel for that market — as the listing cards do.
    const marketIso = (listing.marketplace || iso || '').toUpperCase().replace(/^UK$/, 'GB');
    const salesChannel = integration.channelType === 'ebay'
      ? integration.targetCompanyId
        ? await this.prisma.salesChannel.findFirst({
          where: { deletedAt: null, companyId: integration.targetCompanyId, name: { contains: 'ebay', mode: 'insensitive' }, nativeCountry: { isoCode: marketIso } },
          select: { id: true, nativeCurrency: true },
        })
        : null
      : integration.targetSalesChannelId
        ? await this.prisma.salesChannel.findFirst({ where: { id: integration.targetSalesChannelId }, select: { id: true, nativeCurrency: true } })
        : null;

    // Jinius sells in Cyprus, in euro, and resolves its sales channel the way OnBuy does: the one
    // named on the connection. Only eBay needs a channel per market.
    const currency = (listing.currency ?? salesChannel?.nativeCurrency ?? (integration.channelType === 'onbuy' ? 'GBP' : 'EUR')).toUpperCase();
    return { integration, listing, salesChannelId: salesChannel?.id ?? null, currency, marketIso };
  }

  /** What the live price earns, what a typed one would, and what we would suggest. Read-only. */
  async check(t: ListingPriceTarget & { atPriceCents?: number | null }, companyIds?: string[]) {
    const { integration, listing, salesChannelId, currency, marketIso } = await this.resolve(t, companyIds);
    const currentCents = listing.listedPrice != null ? Math.round(listing.listedPrice * 100) : null;
    const note = integration.channelType === 'ebay' && marketIso !== 'GB'
      ? 'eBaymag republishes the eBay UK listing to this market and may set its own price here on its next sync.'
      : null;
    if (!salesChannelId) {
      return { ok: false as const, reason: `No sales channel is linked to ${integration.name}${integration.channelType === 'ebay' ? ` for ${marketIso}` : ''}, so no profit can be worked out`, sku: listing.channelSku, currentCents, note };
    }

    const prices = [...new Set([currentCents, t.atPriceCents].filter((p): p is number => p != null && p > 0))];
    const econ = await this.prices.listingEconomics(prices.map((p) => ({ key: String(p), productId: t.productId, salesChannelId, grossNative: p / 100, currency })));
    const settings = await this.prisma.platformSettings.findFirst({ select: { launchMarginPct: true } });
    const target = settings?.launchMarginPct != null ? Number(settings.launchMarginPct) : 20;
    const [suggested, breakeven] = await Promise.all([
      this.prices.priceForMargin(t.productId, salesChannelId, target),
      this.prices.priceForMargin(t.productId, salesChannelId, 0),
    ]);
    if (suggested.priceNative == null || breakeven.priceNative == null) {
      return { ok: false as const, reason: [...new Set([...suggested.problems, ...breakeven.problems])].join('; ') || 'No price could be worked out for this product', sku: listing.channelSku, currentCents, note };
    }

    const at = (cents: number | null | undefined) => (cents == null ? null : profitEntry(cents, econ.get(String(cents))));
    const anyEcon = [...econ.values()][0];
    const eurPerUnit = anyEcon?.priceEur && prices[0] ? anyEcon.priceEur / (prices[0] / 100) : null;

    return {
      ok: true as const,
      sku: listing.channelSku,
      currency,
      currentCents,
      current: at(currentCents),
      proposed: at(t.atPriceCents),
      suggestedCents: Math.round(suggested.priceNative * 100),
      breakevenCents: Math.round(breakeven.priceNative * 100),
      targetMarginPct: target,
      fx: { currency, eurPerUnit: eurPerUnit ?? 1 },
      note,
      problems: suggested.problems,
    };
  }

  /**
   * Send a new price. Validated only — nothing reaches the channel — unless price writes are on AND
   * the caller confirmed: two independent yeses, the same as Amazon's.
   */
  async update(t: ListingPriceTarget & { priceCents: number; confirm?: boolean }, actorId?: string, companyIds?: string[]) {
    if (!Number.isFinite(t.priceCents) || t.priceCents <= 0) throw new BadRequestException('A price above zero is required');
    const { integration, listing, currency, marketIso } = await this.resolve(t, companyIds);
    const live = await this.priceWritesEnabled();
    const dryRun = !(live && t.confirm === true);
    const price = t.priceCents / 100;

    let result: { ok: boolean; message: string };
    if (integration.channelType === 'jinius') {
      // Mirakl keys an offer on the seller's own SKU, and takes a partial update: the price moves,
      // the quantity on the offer is left exactly as it is.
      result = await this.integrations.pushJiniusPrice(integration.id, listing.channelSku, price, dryRun);
    } else if (integration.channelType === 'onbuy') {
      if (dryRun) {
        result = { ok: true, message: `validated (set SKU ${listing.channelSku} to ${price.toFixed(2)} on OnBuy)` };
      } else {
        const r = await this.integrations.onbuyUpdateBySku(integration.id, { listings: [{ sku: listing.channelSku, price }] });
        const row = (Array.isArray(r.json?.results) ? r.json.results : [])[0];
        result = r.ok && row?.success !== false
          ? { ok: true, message: `price set to ${price.toFixed(2)} ${currency}` }
          : { ok: false, message: `OnBuy refused the price: ${r.ok ? String(row?.message ?? 'no reason given') : `HTTP ${r.status}`}` };
      }
    } else {
      // Published by this platform? Then it is an Inventory API offer, and only that API may change it.
      const offers = await this.integrations.ebayOffersForSku(integration.id, listing.channelSku, `EBAY_${marketIso}`).catch(() => null);
      const offer = offers?.ok
        ? offers.offers.find((o) => o.status === 'PUBLISHED' && (!listing.externalListingId || o.listingId === listing.externalListingId)) ?? null
        : null;
      if (offer) {
        result = dryRun
          ? { ok: true, message: `validated (offer ${offer.offerId} → ${price.toFixed(2)} ${currency})` }
          : await this.integrations.ebayUpdateOfferPrice(integration.id, listing.channelSku, offer.offerId, price, currency);
      } else {
        result = await this.integrations.pushEbayPrice(integration.id, listing.channelSku, marketIso, price, dryRun, listing.externalListingId);
      }
    }

    await this.prisma.channelPush.create({
      data: {
        companyId: integration.targetCompanyId,
        integrationId: integration.id,
        productId: t.productId,
        channelSku: listing.channelSku,
        marketplace: listing.marketplace ?? '',
        field: 'price',
        requestedValue: t.priceCents,
        previousValue: listing.listedPrice != null ? Math.round(listing.listedPrice * 100) : null,
        ok: result.ok,
        message: result.message.slice(0, 300),
        dryRun,
        createdById: actorId ?? null,
      },
    });

    // Our own record follows only a real, accepted change; the next sync confirms it.
    if (result.ok && !dryRun) {
      await this.prisma.channelListing.update({ where: { id: listing.id }, data: { listedPrice: price, lastPushedAt: new Date() } });
      // The plan's price follows too where there is one for this SKU, so a later update does not
      // send the old number back.
      await this.prisma.productChannelPlan.updateMany({
        where: { productId: t.productId, integrationId: integration.id, channelSku: listing.channelSku, deletedAt: null },
        data: { offerPriceCents: t.priceCents, updatedById: actorId ?? null },
      });
      this.logger.log(`${integration.channelType} price set: ${listing.channelSku} → ${price.toFixed(2)} ${currency}`);
    }

    return {
      ok: result.ok,
      dryRun,
      liveWritesEnabled: live,
      sku: listing.channelSku,
      currency,
      priceCents: t.priceCents,
      status: result.ok ? (dryRun ? 'VALIDATED' : 'ACCEPTED') : 'REJECTED',
      message: result.message,
    };
  }
}
