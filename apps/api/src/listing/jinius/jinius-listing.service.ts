import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { PricingService } from '../../pricing/pricing.service';
import { profitEntry, type ProfitEntry } from '../price/listing-price';
import { readJiniusProductMatches } from '../../jinius/jinius-catalogue';
import {
  JINIUS_STATE_NEW, jiniusNewOfferBody, jiniusOfferIdentity, missingForJiniusListing, warningsForJiniusListing,
  type JiniusListingInput,
} from './jinius-listing';

/**
 * Listing a product on Jinius, against a product its catalogue already carries.
 *
 * Built on what the discovery run established rather than on assumptions, because the assumptions
 * were wrong three times running:
 *
 *   - Jinius matches products by EAN, and answers a comma-separated list as we already send it.
 *   - It answers in a shape of its own, so a product is tied back to what we asked by the reference
 *     itself rather than by a field name Mirakl documents.
 *   - An offer is keyed on OUR shop SKU, and carries `state_code: "11"` for new goods.
 *   - Mirakl QUEUES an offer write. Accepting is not listing, so a created offer is recorded as
 *     SUBMITTED and the next listings sync settles it — the same wait Amazon's offers go through.
 *
 * Products Jinius does not carry need a product import, which it permits. That is a different shape
 * of work with content behind it, and nothing here attempts it.
 */
@Injectable()
export class JiniusListingService {
  private readonly logger = new Logger(JiniusListingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly prices: PricingService,
  ) {}

  /** The same gate eBay, Amazon and OnBuy listing use: the environment overrules the setting. */
  async liveWritesEnabled(): Promise<boolean> {
    if (process.env.LISTING_LIVE_WRITES === 'false') return false;
    const settings = await this.prisma.platformSettings.findFirst({ select: { listingLiveWrites: true } });
    return settings?.listingLiveWrites ?? false;
  }

  private async jiniusIntegration(integrationId: string, companyIds?: string[]) {
    const scope = companyIds ? { targetCompanyId: { in: companyIds } } : {};
    const row = await this.prisma.channelIntegration.findFirst({
      where: { id: integrationId, deletedAt: null, channelType: 'jinius', ...scope },
      select: { id: true, name: true, marketplace: true, targetSalesChannelId: true, targetCompanyId: true },
    });
    if (!row) throw new NotFoundException('Jinius integration not found');
    return row;
  }

  /**
   * The plan row, found the way the plan editor SAVES it.
   *
   * A plan is keyed on the integration's own marketplace, which is "CY" for Jinius rather than the
   * empty string. Looking under '' found nothing, so a price somebody had just typed and saved came
   * back as "No price set for Jinius" and the create button stayed dead. The key is read from the
   * integration here for the same reason it is written from it there.
   */
  private async plan(productId: string, integrationId: string) {
    const integration = await this.prisma.channelIntegration.findFirst({ where: { id: integrationId }, select: { marketplace: true } });
    return this.prisma.productChannelPlan.findFirst({
      where: { productId, integrationId, marketplace: integration?.marketplace ?? '', deletedAt: null },
      select: { id: true, channelSku: true, condition: true, offerPriceCents: true, status: true, externalListingId: true },
    });
  }

  /**
   * Everything one offer is made of, resolved once.
   *
   * Preview and create call this same method, so what a person was shown is what gets sent — the
   * two cannot drift apart, which is the only way a preview is worth reading.
   */
  private async buildInput(productId: string, integrationId: string) {
    const [product, plan, availability] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, mainSku: true, title: true, ean: true } }),
      this.plan(productId, integrationId),
      this.prisma.productAvailability.findUnique({ where: { productId }, select: { quantity: true } }),
    ]);
    if (!product) throw new NotFoundException('Product not found');

    const sku = (plan?.channelSku ?? product.mainSku ?? '').trim() || null;
    const ean = (product.ean ?? '').trim() || null;

    /** An offer already there is a fact about Jinius, so it is read from what the last sync saw. */
    const existing = sku
      ? await this.prisma.channelListing.findFirst({ where: { integrationId, channelSku: sku }, select: { listedQuantity: true, listedPrice: true } })
      : null;

    /** Their catalogue, asked with the barcode — the one thing the probe proved works. */
    let match: ReturnType<typeof readJiniusProductMatches>[number] | null = null;
    let lookupProblem: string | null = null;
    if (ean) {
      const r = await this.integrations.jiniusGet(integrationId, '/api/products', { product_references: `EAN|${ean}` });
      if (r.ok) match = readJiniusProductMatches(r.json, [ean])[0] ?? null;
      else lookupProblem = `Jinius answered ${r.status} when asked whether it carries ${ean}.`;
    } else {
      lookupProblem = 'This product has no barcode, and Jinius matches its catalogue by EAN.';
    }

    const identity = jiniusOfferIdentity(match?.found ? match : null, ean);
    const input: JiniusListingInput = {
      sku,
      productId: identity.productId,
      productIdType: identity.productIdType,
      price: plan?.offerPriceCents != null ? plan.offerPriceCents / 100 : null,
      stock: availability?.quantity ?? 0,
      condition: plan?.condition ?? 'NEW',
      alreadyListed: !!existing,
    };
    return { product, plan, input, match, existing, lookupProblem };
  }

  /** A price at the platform's launch margin, and what a typed one would earn. The same model as everywhere. */
  async pricing(productId: string, integrationId: string, companyIds?: string[], atPriceCents?: number) {
    const integration = await this.jiniusIntegration(integrationId, companyIds);
    const channelId = integration.targetSalesChannelId;
    if (!channelId) {
      return {
        suggestion: null, breakevenNative: null, at: null,
        problems: ['This Jinius connection is not linked to a sales channel, so there is no fee or VAT to price with. Link one in Setup → Integrations.'],
      };
    }
    const settings = await this.prisma.platformSettings.findFirst({ select: { launchMarginPct: true } });
    const target = settings?.launchMarginPct != null ? Number(settings.launchMarginPct) : 20;
    const [r, breakeven] = await Promise.all([
      this.prices.priceForMargin(productId, channelId, target),
      this.prices.priceForMargin(productId, channelId, 0),
    ]);
    let at: ProfitEntry | null = null;
    if (atPriceCents != null) {
      const econ = await this.prices.listingEconomics([{ key: 'at', productId, salesChannelId: channelId, grossNative: atPriceCents / 100, currency: r.currency }]);
      at = profitEntry(atPriceCents, econ.get('at'));
    }
    return { suggestion: { ...r, targetMarginPct: target }, breakevenNative: breakeven.priceNative, at, problems: r.problems };
  }

  /** Step 4, read-only: whether Jinius carries it, what would be sent, and what still stops it. */
  async preview(productId: string, integrationId: string, companyIds?: string[]) {
    await this.jiniusIntegration(integrationId, companyIds);
    const { product, plan, input, match, existing, lookupProblem } = await this.buildInput(productId, integrationId);
    const live = await this.liveWritesEnabled();
    return {
      sku: input.sku,
      ean: (product.ean ?? '').trim() || null,
      carried: !!match?.found,
      /** What Jinius holds for it, so a person can see they are about to sell the right thing. */
      theirProduct: match?.found
        ? { productId: match.productId, productIdType: match.productIdType, title: match.title, categoryCode: match.categoryCode, categoryLabel: match.categoryLabel }
        : null,
      lookupProblem,
      offer: {
        shopSku: input.sku,
        productId: input.productId,
        productIdType: input.productIdType,
        price: input.price,
        quantity: Math.max(0, Math.round(input.stock)),
        stateCode: JINIUS_STATE_NEW,
      },
      existing: existing ? { quantity: existing.listedQuantity, price: existing.listedPrice } : null,
      blockers: missingForJiniusListing(input),
      warnings: warningsForJiniusListing(input),
      planStatus: plan?.status ?? null,
      liveWrites: live,
    };
  }

  /**
   * Create the offer on Jinius.
   *
   * Two independent yeses, as every other channel's listing has: the platform-wide "live listing
   * writes" setting AND an explicit confirm from the person. Without both it validates and sends
   * nothing, which is the shape of a dry run rather than a refusal.
   */
  async create(productId: string, integrationId: string, opts: { confirm?: boolean }, actorId?: string, companyIds?: string[]) {
    const integration = await this.jiniusIntegration(integrationId, companyIds);
    const { input } = await this.buildInput(productId, integrationId);
    const blockers = missingForJiniusListing(input);
    if (blockers.length) throw new BadRequestException(blockers.join(' '));

    const live = await this.liveWritesEnabled();
    const dryRun = !(live && opts.confirm === true);
    if (dryRun) {
      return {
        ok: true as const, dryRun: true, importId: null as number | null,
        message: `Validated. Would create ${input.sku} on Jinius at €${(input.price ?? 0).toFixed(2)} with ${Math.max(0, Math.round(input.stock))} in stock.`,
      };
    }

    const r = await this.integrations.jiniusCreateOffer(integration.id, jiniusNewOfferBody(input));

    /**
     * SUBMITTED, not LISTED. Mirakl queues the write, so the offer does not exist yet however
     * cleanly the request was accepted — the next listings sync is what finds it and settles the
     * plan, exactly as it does for an Amazon offer.
     */
    if (r.ok) {
      await this.prisma.productChannelPlan.updateMany({
        where: { productId, integrationId, marketplace: integration.marketplace ?? '', deletedAt: null },
        data: { status: 'SUBMITTED', updatedById: actorId ?? null },
      });
      this.logger.log(`Jinius offer submitted: ${input.sku} at ${input.price} x${input.stock} (${r.message})`);
    }

    await this.prisma.channelPush.create({
      data: {
        companyId: integration.targetCompanyId, integrationId: integration.id, productId,
        // Empty, matching the listing rows: a Jinius offer is not per-market the way an eBay one is.
        channelSku: input.sku ?? '', marketplace: '', field: 'listing',
        requestedValue: Math.round((input.price ?? 0) * 100), previousValue: null,
        ok: r.ok, message: r.message.slice(0, 300), dryRun: false, createdById: actorId ?? null,
      },
    });

    return { ok: r.ok, dryRun: false, importId: r.importId, message: r.message };
  }
}
