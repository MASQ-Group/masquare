import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateEligibility, type MarketProfile, type ProductTechnical } from './eligibility';
import { evaluateReadiness, checkBoost, type ListingFacts } from './readiness';

/**
 * The channels that can carry a listing. Anything else is ignored rather than guessed at.
 *
 * Shopify is deliberately absent: our own store is a separate module, not a marketplace we attach
 * offers to, and treating it as one here would put a storefront behind marketplace rules.
 */
const LISTABLE_CHANNELS = ['amazon', 'ebay', 'onbuy'];

export interface ChannelPlanPatch {
  offerPriceCents?: number | null;
  categoryRef?: string | null;
  categoryName?: string | null;
  aspects?: Record<string, unknown> | null;
  condition?: string;
  handlingTimeDays?: number | null;
  deliveryTemplate?: string | null;
  boostPct?: number;
  status?: string;
}

@Injectable()
export class ListingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reference data for the eligibility rules. Editable, so it is read fresh rather than cached. */
  marketplaceProfiles() {
    return this.prisma.marketplaceProfile.findMany({ orderBy: [{ channelType: 'asc' }, { marketplace: 'asc' }] });
  }

  async updateMarketplaceProfile(id: string, patch: Record<string, unknown>) {
    const existing = await this.prisma.marketplaceProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Marketplace profile not found');
    return this.prisma.marketplaceProfile.update({ where: { id }, data: patch });
  }

  /**
   * Every connected channel for one product, each with its own verdict.
   *
   * Two verdicts, deliberately separate. Readiness is what we have not typed yet and reads as a
   * to-do; eligibility is whether the product may be sold there at all and cannot be typed away.
   * Neither is stored — both are derived on read, so correcting a voltage or filling in a title
   * fixes every affected channel at once instead of leaving stale verdicts behind.
   */
  async productChannels(productId: string, companyIds?: string[]) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: {
        media: { where: { deletedAt: null }, select: { id: true } },
        brand: { select: { id: true, name: true, manufacturerName: true, euRpName: true } },
        // The rules compare numbers, and the numbers live on the chosen rating.
        voltageRating: { select: { code: true, label: true, numericMin: true, numericMax: true } },
        frequency: { select: { code: true, label: true } },
        plugTypeRef: { select: { code: true, label: true } },
        hazmatClassRef: { select: { code: true, label: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const [integrations, profiles, plans, liveListings] = await Promise.all([
      this.prisma.channelIntegration.findMany({
        // Company-scoped, like the Channel Listings page beside it. Both companies sell on most of
        // the same marketplaces through their own seller accounts, so an unscoped read returns two
        // rows per marketplace — indistinguishable on screen, and only one of them the caller's.
        where: {
          deletedAt: null,
          channelType: { in: LISTABLE_CHANNELS },
          ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
        },
        select: { id: true, name: true, channelType: true, marketplace: true, status: true },
        orderBy: [{ channelType: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.marketplaceProfile.findMany(),
      this.prisma.productChannelPlan.findMany({ where: { productId, deletedAt: null } }),
      // Where this product is already live. Read from the listings the channel sync has already
      // pulled rather than asked of each marketplace: it is instant, free of rate limits, and it
      // is the same data the Channel Listings page is built on.
      this.prisma.channelListing.findMany({
        where: { productId },
        select: {
          integrationId: true, channelSku: true, marketplace: true, asin: true,
          externalListingId: true, listedPrice: true, listedQuantity: true,
          currency: true, listingStatus: true, lastPulledAt: true,
        },
      }),
    ]);

    const profileFor = (channelType: string, marketplace: string | null): MarketProfile | null => {
      // An exact channel+marketplace profile first, then a channel-wide fallback ('' marketplace).
      const exact = profiles.find((p) => p.channelType === channelType && p.marketplace === (marketplace ?? ''));
      const wide = profiles.find((p) => p.channelType === channelType && p.marketplace === '');
      const row = exact ?? wide;
      return row && row.active ? (row as MarketProfile) : null;
    };

    // A rating with no range — "battery powered", "not electrical" — is not a missing answer, so it
    // must not be treated as one: it passes every market rather than failing for want of a number.
    const technical: ProductTechnical = {
      voltageMinV: product.voltageRating?.numericMin ?? null,
      voltageMaxV: product.voltageRating?.numericMax ?? null,
      frequencyHz: product.frequency?.code ?? null,
      plugType: product.plugTypeRef?.code ?? null,
      batteryRequired: product.batteryRequired,
      hazmatClass: product.hazmatClassRef?.code ?? null,
    };

    const hasDimensions =
      product.packageLengthCm != null && product.packageWidthCm != null && product.packageHeightCm != null;

    const availability = await this.prisma.productAvailability.findUnique({
      where: { productId },
      select: { quantity: true },
    });

    /**
     * How many units an offer here would carry, and where the number came from.
     *
     * Availability owns sellable stock for the whole platform. Where a product has none recorded,
     * what we already publish on a sibling marketplace of the same channel is the last figure we
     * told that channel we held — better than refusing to quote, as long as the source is named.
     * A quantity that appears from nowhere is worse than one somebody had to type.
     */
    const resolveQuantity = (
      integration: { id: string; channelType: string },
      live: { listedQuantity: number | null } | undefined,
    ): { value: number | null; source: 'availability' | 'this-listing' | 'sibling-listing' | 'none'; from: string | null } => {
      if (availability) return { value: availability.quantity, source: 'availability', from: null };
      if (live?.listedQuantity != null) return { value: live.listedQuantity, source: 'this-listing', from: null };
      const sibling = liveListings
        .filter((l) => l.integrationId !== integration.id && l.listedQuantity != null)
        .map((l) => ({ l, i: integrations.find((x) => x.id === l.integrationId) }))
        .filter((x) => x.i?.channelType === integration.channelType)
        .sort((a, b) => (b.l.lastPulledAt?.getTime() ?? 0) - (a.l.lastPulledAt?.getTime() ?? 0))[0];
      if (sibling?.l.listedQuantity != null) {
        return { value: sibling.l.listedQuantity, source: 'sibling-listing', from: sibling.i?.marketplace ?? sibling.i?.name ?? null };
      }
      return { value: null, source: 'none', from: null };
    };

    const rows = integrations.map((integration) => {
      const plan = plans.find(
        (p) => p.integrationId === integration.id && p.marketplace === (integration.marketplace ?? ''),
      );

      const facts: ListingFacts = {
        ean: product.ean,
        upc: product.upc,
        ebayTitle: product.ebayTitle,
        descriptionHtml: product.descriptionHtml,
        imageCount: product.media.length,
        packageWeightKg: product.packageWeightKg == null ? null : Number(product.packageWeightKg),
        hasPackageDimensions: hasDimensions,
        categoryRef: plan?.categoryRef ?? null,
        condition: plan?.condition ?? 'NEW',
        handlingTimeDays: plan?.handlingTimeDays ?? null,
        deliveryTemplate: plan?.deliveryTemplate ?? null,
        // Always empty until the category schemas are fetched live (that lands with eBay listing
        // creation). Reported as a known gap rather than silently counted as satisfied.
        missingRequiredAspects: [],
      };

      const profile = profileFor(integration.channelType, integration.marketplace);

      // eBay splits one integration across marketplaces, so match on both where it carries one.
      const live = liveListings.find(
        (l) => l.integrationId === integration.id
          && (l.marketplace === '' || l.marketplace === (integration.marketplace ?? '')),
      );

      return {
        integrationId: integration.id,
        name: integration.name,
        channelType: integration.channelType,
        marketplace: integration.marketplace ?? '',
        integrationStatus: integration.status,
        plan: plan
          ? {
              id: plan.id,
              categoryRef: plan.categoryRef,
              categoryName: plan.categoryName,
              aspects: plan.aspects,
              condition: plan.condition,
              handlingTimeDays: plan.handlingTimeDays,
              offerPriceCents: plan.offerPriceCents,
              deliveryTemplate: plan.deliveryTemplate,
              boostPct: Number(plan.boostPct),
              status: plan.status,
              externalListingId: plan.externalListingId,
              listedAt: plan.listedAt,
            }
          : null,
        readiness: evaluateReadiness(integration.channelType, facts),
        eligibility: profile
          ? evaluateEligibility(technical, profile)
          : // No profile means nothing to judge against. Reported as such rather than as a pass —
            // an unknown market is not a cleared one.
            { eligible: true, findings: [], unchecked: ['VOLTAGE' as const], noProfile: true },
        // Only aspects are pending; everything else the readiness check reports is real.
        aspectsPending: integration.channelType === 'ebay',
        quantity: resolveQuantity(integration, live),
        listing: live
          ? {
              channelSku: live.channelSku,
              asin: live.asin,
              externalListingId: live.externalListingId,
              price: live.listedPrice,
              currency: live.currency,
              quantity: live.listedQuantity,
              status: live.listingStatus,
              lastPulledAt: live.lastPulledAt,
            }
          : null,
      };
    });

    return {
      productId,
      brand: product.brand,
      channels: rows,
      summary: {
        eligible: rows.filter((r) => r.eligibility.eligible).length,
        ready: rows.filter((r) => r.readiness.ready && r.eligibility.eligible).length,
        blocked: rows.filter((r) => !r.eligibility.eligible).length,
        // Counted first in the UI: listing something twice is worse than not listing it.
        listed: rows.filter((r) => r.listing).length,
        total: rows.length,
      },
    };
  }

  /**
   * Create or update the plan for one product on one channel.
   *
   * Refuses rather than warns on an over-limit boost: OnBuy's own default is 20% of revenue, and a
   * warning on a bulk action is read once while the commission is paid every month afterwards.
   */
  async upsertPlan(
    productId: string,
    integrationId: string,
    patch: ChannelPlanPatch,
    actorId?: string,
    companyIds?: string[],
  ) {
    const [product, integration, settings] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } }),
      this.prisma.channelIntegration.findFirst({
        // Scoped for the same reason the read is, and here it matters more: an id is enough to
        // reach a channel, so without this a plan could be written against the other company's
        // seller account by anyone who happened to know its id.
        where: { id: integrationId, deletedAt: null, ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}) },
        select: { id: true, channelType: true, marketplace: true },
      }),
      this.prisma.platformSettings.findFirst({ select: { maxBoostPct: true } }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!integration) throw new NotFoundException('Channel not found');
    if (!LISTABLE_CHANNELS.includes(integration.channelType)) {
      throw new BadRequestException(`${integration.channelType} listings are not supported`);
    }

    if (patch.boostPct != null) {
      const verdict = checkBoost(patch.boostPct, Number(settings?.maxBoostPct ?? 0));
      if (!verdict.ok) throw new BadRequestException(verdict.reason);
    }

    // Nothing here publishes. A plan reaching READY means a human may now list it, not that
    // anything has been sent to the channel.
    if (patch.status && !['DRAFT', 'READY', 'ARCHIVED'].includes(patch.status)) {
      throw new BadRequestException('A listing is marked LISTED by the channel, not by hand');
    }

    const marketplace = integration.marketplace ?? '';
    const data = {
      categoryRef: patch.categoryRef,
      categoryName: patch.categoryName,
      aspects: patch.aspects === null ? undefined : (patch.aspects as object | undefined),
      condition: patch.condition,
      handlingTimeDays: patch.handlingTimeDays,
      offerPriceCents: patch.offerPriceCents,
      deliveryTemplate: patch.deliveryTemplate,
      boostPct: patch.boostPct,
      status: patch.status,
    };
    // Undefined keys must not reach Prisma as explicit nulls, or a partial edit clears the rest.
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

    return this.prisma.productChannelPlan.upsert({
      where: { productId_integrationId_marketplace: { productId, integrationId, marketplace } },
      create: {
        productId,
        integrationId,
        marketplace,
        ...clean,
        createdById: actorId,
        updatedById: actorId,
      },
      update: { ...clean, updatedById: actorId, deletedAt: null },
    });
  }

  /** Drop a plan. The listing, if one exists on the channel, is untouched — this is our intent only. */
  async removePlan(productId: string, integrationId: string, marketplace: string) {
    await this.prisma.productChannelPlan.updateMany({
      where: { productId, integrationId, marketplace },
      data: { deletedAt: new Date() },
    });
    return { removed: true };
  }
}
