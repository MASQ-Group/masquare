import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { buildOfferAttributes, CONDITION_CODES, mergeOverLiveAttributes, type OfferInput } from './offer-payload';
import { evaluateEligibility, type MarketProfile } from '../eligibility';
import { FloorService } from '../../amazon-repricing/floor/floor.service';
import { fullScopeIntegrationWhere, isOrdersOnlyCompany } from '../../common/amazon-scope';

/**
 * Creating an offer on an existing Amazon listing.
 *
 * Three gates stand between this code and a real offer, and all three must be open: the server-side
 * env switch, an explicit confirm from the caller, and a product that is both ready and eligible.
 * Everything else runs as VALIDATION_PREVIEW, which asks Amazon the same question and creates
 * nothing. The default in every path is the dry run.
 */
@Injectable()
export class AmazonListingService {
  private readonly logger = new Logger(AmazonListingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly floors: FloorService,
  ) {}

  /**
   * Whether a real listing may be created.
   *
   * Two gates, and the environment overrules the setting. LISTING_LIVE_WRITES=false forces off no
   * matter what the toggle says, so a server can be made incapable of listing regardless of who is
   * clicking — the same shape as the repricing kill switch. Unset means the toggle decides.
   */
  async liveWritesEnabled(): Promise<boolean> {
    if (process.env.LISTING_LIVE_WRITES === 'false') return false;
    const settings = await this.prisma.platformSettings.findFirst({ select: { listingLiveWrites: true } });
    return settings?.listingLiveWrites ?? false;
  }

  /**
   * Find the ASIN this product should attach to, and whether we may offer on it.
   *
   * Searched by EAN then UPC, never by title: a title match is how an offer ends up on a
   * similar-looking product, and the customer receives the wrong thing at our price. Every
   * candidate is returned with its own restriction verdict so a human picks knowingly.
   */
  async findCandidates(productId: string, integrationId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, mainSku: true, title: true, ean: true, upc: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const identifier = product.ean?.trim() || product.upc?.trim() || null;
    const identifierType: 'EAN' | 'UPC' = product.ean?.trim() ? 'EAN' : 'UPC';
    if (!identifier) {
      return {
        productId,
        searchedBy: null,
        candidates: [],
        boundAsin: null,
        boundOn: [],
        message: 'This product has no EAN or UPC. Amazon can only be searched on a unique identifier — a title match would risk attaching the offer to a different product.',
      };
    }

    /**
     * The ASIN this SKU is already bound to elsewhere.
     *
     * Amazon requires one SKU to map to one ASIN across every marketplace, and refuses a submission
     * that breaks it — "the seller-suggested ASIN value is not uniform across active Amazon sales
     * sites". That refusal arrives at validation, in the marketplace's own language, naming two
     * ASINs and leaving the reader to work out which is which. We already hold the answer, so it is
     * far better said at the moment of choosing.
     */
    const boundElsewhere = await this.prisma.channelListing.findMany({
      where: {
        channelSku: product.mainSku,
        asin: { not: null },
        // Amazon enforces one SKU to one ASIN WITHIN a seller account. Another company's account is
        // a different seller, so its binding constrains nothing here and must not be read as if it did.
        integration: { channelType: 'amazon', deletedAt: null, ...(await fullScopeIntegrationWhere(this.prisma)) },
        integrationId: { not: integrationId },
      },
      select: { asin: true, integration: { select: { marketplace: true, name: true } } },
    });
    const boundAsin = boundElsewhere[0]?.asin ?? null;
    const boundOn = [...new Set(boundElsewhere.map((l) => l.integration.marketplace ?? l.integration.name))];

    const search = await this.integrations.searchAmazonCatalog(integrationId, [identifier], identifierType);
    if (!search.ok) {
      return { productId, searchedBy: { type: identifierType, value: identifier }, candidates: [], message: search.message, boundAsin, boundOn };
    }

    // Restrictions are per ASIN, so each candidate is checked on its own. Sequential on purpose:
    // there are rarely more than a handful, and SP-API rate limits are unkind to bursts.
    const candidates: Array<{
      asin: string; productType: string | null; title: string | null; brand: string | null; imageUrl: string | null;
      /** True when this SKU is already bound to a different ASIN — Amazon refuses the mismatch. */
      conflictsWithBound: boolean;
      restricted: boolean | null;
      restrictionReasons: Array<{ message: string; reasonCode: string | null; linkUrl: string | null }>;
      restrictionError: string | null;
    }> = [];
    for (const item of search.items) {
      const restrictions = await this.integrations.getAmazonListingRestrictions(integrationId, item.asin);
      candidates.push({
        ...item,
        // Amazon will refuse any candidate other than the one this SKU already uses.
        conflictsWithBound: boundAsin != null && item.asin !== boundAsin,
        restricted: restrictions.ok ? restrictions.restricted : null,
        restrictionReasons: restrictions.reasons,
        restrictionError: restrictions.ok ? null : restrictions.message ?? null,
      });
    }

    // The bound ASIN first. The sweep takes candidates[0] and the picker defaults to it, so leaving
    // Amazon's own ordering to decide would sometimes pick the one ASIN we know it will refuse.
    if (boundAsin) candidates.sort((a, b) => Number(a.conflictsWithBound) - Number(b.conflictsWithBound));

    return {
      productId,
      searchedBy: { type: identifierType, value: identifier },
      candidates,
      /** The ASIN this SKU already uses on other marketplaces, if any. */
      boundAsin,
      boundOn,
      message: candidates.length === 0 ? 'Amazon has no catalogue entry for this identifier in this marketplace.' : null,
    };
  }

  /**
   * Search every connected Amazon marketplace at once.
   *
   * Amazon's catalogue is per marketplace: an EAN that resolves in DE may not exist in JP, and a
   * brand we are approved for in the UK may be gated in the US. Answering "where can we sell this"
   * therefore means asking each one, which is why this runs as a job — eighteen marketplaces at two
   * calls apiece is a minute of sequential work, and SP-API rate limits punish doing it faster.
   */
  async sweepMarketplaces(
    productId: string,
    ctx?: { setTotal(n: number): void; tick(ok?: boolean): void; note(m: string): void },
    opts: { withPricing?: boolean; companyIds?: string[] } = {},
  ) {
    const integrations = await this.prisma.channelIntegration.findMany({
      // Company-scoped: the two companies hold separate seller accounts on most of the same
      // marketplaces, so an unscoped sweep searches the other company's account as well and
      // reports its results as though they were ours. The amazon-scope filter beside it answers a
      // different question — whether an account is ours to touch at all — and neither replaces the
      // other.
      where: {
        deletedAt: null,
        channelType: 'amazon',
        ...(opts.companyIds ? { targetCompanyId: { in: opts.companyIds } } : {}),
        ...(await fullScopeIntegrationWhere(this.prisma)),
      },
      select: { id: true, name: true, marketplace: true },
      orderBy: { marketplace: 'asc' },
    });
    ctx?.setTotal(integrations.length);

    // Where we already sell it. Without this, "can be listed" counts marketplaces we are already on
    // — an opportunity that does not exist, and the one number someone would act on.
    const liveListings = await this.prisma.channelListing.findMany({
      where: { productId, integrationId: { in: integrations.map((i) => i.id) } },
      select: { integrationId: true, channelSku: true, asin: true },
    });

    const results: Array<{
      integrationId: string; name: string; marketplace: string;
      found: boolean; asin: string | null; productType: string | null; title: string | null;
      restricted: boolean | null; restrictionReason: string | null; error: string | null;
      alreadyListed: boolean; listedSku: string | null;
      /** The currency every money figure on this row is in. A marketplace has exactly one. */
      currency: string;
      /** What the offer that currently wins the Buy Box charges, and what we would make at it. */
      featuredPriceCents: number | null;
      featuredProfitCents: number | null;
      featuredMarginPct: number | null;
      lowestPriceCents: number | null;
      /** True when we could win the Buy Box at a profit. The question worth asking before listing. */
      competitive: boolean | null;
    }> = [];

    for (const integration of integrations) {
      ctx?.note(integration.marketplace ?? integration.name);
      const live = liveListings.find((l) => l.integrationId === integration.id) ?? null;
      try {
        const found = await this.findCandidates(productId, integration.id);
        // The first candidate is the answer where there is exactly one. More than one is rare and
        // means a human should look, so it is reported rather than resolved here.
        const top = found.candidates[0] ?? null;
        results.push({
          integrationId: integration.id,
          name: integration.name,
          marketplace: integration.marketplace ?? '',
          found: !!top,
          asin: top?.asin ?? null,
          productType: top?.productType ?? null,
          title: top?.title ?? null,
          restricted: top?.restricted ?? null,
          restrictionReason: top?.restrictionReasons?.[0]?.message ?? null,
          error: top ? null : (found.message ?? 'No catalogue entry for this identifier'),
          alreadyListed: !!live,
          listedSku: live?.channelSku ?? null,
          // Priced only where listing is actually on the table: two more live calls per marketplace,
          // and there is nothing to decide about one we are already on or cannot sell in.
          ...(opts.withPricing && top && !live && top.restricted === false
            ? await this.priceAgainstCompetition(productId, integration.id, integration.marketplace ?? '', top.asin)
            : {
                currency: currencyForMarketplace(integration.marketplace),
                featuredPriceCents: null, featuredProfitCents: null, featuredMarginPct: null,
                lowestPriceCents: null, competitive: null,
              }),
        });
        ctx?.tick(true);
      } catch (e) {
        // One marketplace failing must not lose the seventeen that worked.
        results.push({
          integrationId: integration.id, name: integration.name, marketplace: integration.marketplace ?? '',
          found: false, asin: null, productType: null, title: null,
          restricted: null, restrictionReason: null, error: (e as Error)?.message ?? 'Search failed',
          alreadyListed: !!live,
          listedSku: live?.channelSku ?? null,
          currency: currencyForMarketplace(integration.marketplace),
          featuredPriceCents: null, featuredProfitCents: null, featuredMarginPct: null,
          lowestPriceCents: null, competitive: null,
        });
        ctx?.tick(false);
      }
    }

    return {
      productId,
      results,
      summary: {
        searched: results.length,
        found: results.filter((r) => r.found).length,
        // Already listed is counted first and excluded from everything else: a marketplace we are
        // already on is not somewhere we "can list", and it is not an opportunity to act on.
        alreadyListed: results.filter((r) => r.alreadyListed).length,
        sellable: results.filter((r) => r.found && r.restricted === false && !r.alreadyListed).length,
        restricted: results.filter((r) => r.restricted === true && !r.alreadyListed).length,
        /** Of the ones we could list, how many we could win the Buy Box on at a profit. */
        competitive: results.filter((r) => r.competitive === true).length,
        uncompetitive: results.filter((r) => r.competitive === false).length,
        notFound: results.filter((r) => !r.found && !r.alreadyListed && !r.error).length,
        failed: results.filter((r) => r.error && !r.found && !r.alreadyListed).length,
      },
    };
  }

  /**
   * What this product should launch at on one marketplace, and what a given price would earn.
   *
   * Both come from the repricing floor engine — the same tax resolution, landed cost, FX, fees and
   * solver the floors are built on — so the profit quoted here and the profit quoted anywhere else
   * in the platform are the same number by construction rather than by coincidence.
   */
  /**
   * Refuse to do listing work on an orders-only company's integration.
   *
   * The scope filter already makes those integrations invisible to the sweep, so nothing in the UI
   * offers them. This covers the direct call — an integration id in a URL, a stale tab, a script —
   * because an integration that cannot be chosen is not the same as one that cannot be used.
   */
  private async assertListingAllowed(integrationId: string): Promise<void> {
    const integration = await this.prisma.channelIntegration.findFirst({
      where: { id: integrationId, deletedAt: null },
      select: { name: true, targetCompanyId: true },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    if (await isOrdersOnlyCompany(this.prisma, integration.targetCompanyId)) {
      throw new BadRequestException(
        `${integration.name} belongs to a company connected for order history only. Listings and pricing are not performed on this account.`,
      );
    }
  }

  async quote(productId: string, integrationId: string, atPricesCents?: number[]) {
    await this.assertListingAllowed(integrationId);
    const [product, integration, plan, settings] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } }),
      this.prisma.channelIntegration.findFirst({
        where: { id: integrationId, deletedAt: null },
        select: { id: true, marketplace: true, channelType: true },
      }),
      this.prisma.productChannelPlan.findFirst({ where: { productId, integrationId, deletedAt: null } }),
      this.prisma.platformSettings.findFirst({ select: { launchMarginPct: true } }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!integration || integration.channelType !== 'amazon') throw new BadRequestException('Not an Amazon channel');

    const asin = ((plan?.aspects as Record<string, string> | null) ?? {}).asin;
    if (!asin) throw new BadRequestException('Match an Amazon listing first — fees are quoted against the ASIN');

    const iso = (integration.marketplace ?? '').toUpperCase();
    const marketplaceId = MARKETPLACE_IDS[iso];
    if (!marketplaceId) throw new BadRequestException(`Unknown marketplace ${iso}`);

    const marginPct = Number(settings?.launchMarginPct ?? 20) / 100;

    return this.floors.quoteForNewListing({
      productId,
      integrationId,
      marketplaceId,
      currency: MARKETPLACE_CURRENCY[iso] ?? 'EUR',
      asin,
      // FBM unless we know otherwise; an FBA launch is a separate decision nobody has made here.
      isFba: false,
      marginPct,
      atPricesCents: atPricesCents ?? [],
    });
  }


  /**
   * Could we win this listing at a profit?
   *
   * Judged against the FEATURED offer rather than the lowest price. The featured offer is the one
   * that actually takes the sales, while the lowest is frequently an outlier — a used unit, or a
   * seller shipping from another continent — and pricing against it answers a question nobody asked.
   * The lowest is carried alongside for context, not for the verdict.
   */
  private async priceAgainstCompetition(productId: string, integrationId: string, iso: string, asin: string) {
    const currency = currencyForMarketplace(iso);
    const none = { currency, featuredPriceCents: null, featuredProfitCents: null, featuredMarginPct: null, lowestPriceCents: null, competitive: null };
    const marketplaceId = MARKETPLACE_IDS[iso.toUpperCase()];
    if (!marketplaceId) return none;

    const offers = await this.integrations.getAmazonItemOffers(integrationId, asin);
    if (!offers.ok) return none;
    const summary = (offers.summary ?? {}) as { BuyBoxPrices?: RawPriceLike[]; LowestPrices?: RawPriceLike[] };

    const landed = (p?: RawPriceLike) => {
      const listing = money(p?.ListingPrice?.Amount);
      return listing == null ? null : listing + (money(p?.Shipping?.Amount) ?? 0);
    };
    const featured = landed(summary.BuyBoxPrices?.[0]);
    const lowest = landed(summary.LowestPrices?.[0]);
    if (featured == null) return { ...none, lowestPriceCents: lowest };

    const settings = await this.prisma.platformSettings.findFirst({ select: { launchMarginPct: true } });
    const quote = await this.floors.quoteForNewListing({
      productId,
      integrationId,
      marketplaceId,
      currency,
      asin,
      isFba: false,
      marginPct: Number(settings?.launchMarginPct ?? 20) / 100,
      atPricesCents: [featured],
    });
    if (!quote.ok || !quote.at[0]) return { ...none, featuredPriceCents: featured, lowestPriceCents: lowest };

    return {
      currency,
      featuredPriceCents: featured,
      featuredProfitCents: quote.at[0].profitCents,
      featuredMarginPct: quote.at[0].marginPct,
      lowestPriceCents: lowest,
      competitive: quote.at[0].aboveBreakeven,
    };
  }

  /**
   * What the competition charges for this ASIN, and what each of those prices would earn us.
   *
   * Amazon shows a seller three reference prices and a Match button beside each. The prices are
   * genuinely useful; the button is the dangerous part, because none of those numbers know our
   * costs. On the blender that prompted this the featured offer was €70.57 against a €132.99
   * suggestion — matching it would have sold at a heavy loss, and nothing on Amazon's screen says so.
   *
   * So: the same three prices, no Match, and what each one would actually make or lose, computed by
   * the same engine as every other profit figure in the platform.
   */
  async competition(productId: string, integrationId: string) {
    const [product, integration, plan, settings] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } }),
      this.prisma.channelIntegration.findFirst({
        where: { id: integrationId, deletedAt: null },
        select: { id: true, marketplace: true, channelType: true },
      }),
      this.prisma.productChannelPlan.findFirst({ where: { productId, integrationId, deletedAt: null } }),
      this.prisma.platformSettings.findFirst({ select: { launchMarginPct: true } }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!integration || integration.channelType !== 'amazon') throw new BadRequestException('Not an Amazon channel');

    const asin = ((plan?.aspects as Record<string, string> | null) ?? {}).asin;
    if (!asin) throw new BadRequestException('Match an Amazon listing first');

    const iso = (integration.marketplace ?? '').toUpperCase();
    const marketplaceId = MARKETPLACE_IDS[iso];
    if (!marketplaceId) throw new BadRequestException(`Unknown marketplace ${iso}`);
    const currency = MARKETPLACE_CURRENCY[iso] ?? 'EUR';

    const offers = await this.integrations.getAmazonItemOffers(integrationId, asin);
    if (!offers.ok) {
      return { ok: false as const, reason: offers.message ?? 'Amazon would not return offers for this listing' };
    }

    const summary = (offers.summary ?? {}) as {
      BuyBoxPrices?: RawPriceLike[];
      LowestPrices?: RawPriceLike[];
      CompetitivePriceThreshold?: { Amount?: number };
      TotalOfferCount?: number;
      NumberOfOffers?: Array<{ OfferCount?: number }>;
    };

    // Landed, not listing: a price without its shipping is not what a buyer pays, and comparing our
    // delivered price against someone else's ex-shipping price flatters them by exactly the postage.
    const landed = (p?: RawPriceLike): number | null => {
      if (!p) return null;
      const listing = money(p.ListingPrice?.Amount);
      if (listing == null) return null;
      return listing + (money(p.Shipping?.Amount) ?? 0);
    };

    const references: Array<{ kind: 'featured' | 'competitive' | 'lowest'; label: string; priceCents: number | null }> = [
      { kind: 'featured', label: 'Featured offer', priceCents: landed(summary.BuyBoxPrices?.[0]) },
      { kind: 'competitive', label: 'Competitive price', priceCents: money(summary.CompetitivePriceThreshold?.Amount) },
      { kind: 'lowest', label: 'Lowest price', priceCents: landed(summary.LowestPrices?.[0]) },
    ];

    const known = references.filter((r) => r.priceCents != null) as Array<{
      kind: 'featured' | 'competitive' | 'lowest'; label: string; priceCents: number;
    }>;

    // One quote covering every reference price plus our own suggestion: each call costs a live fee
    // estimate, and they all sit on the same cost basis anyway.
    const quote = await this.floors.quoteForNewListing({
      productId,
      integrationId,
      marketplaceId,
      currency,
      asin,
      isFba: false,
      marginPct: Number(settings?.launchMarginPct ?? 20) / 100,
      atPricesCents: known.map((r) => r.priceCents),
    });
    if (!quote.ok) return { ok: false as const, reason: quote.reason };

    const byPrice = new Map(quote.at.map((a) => [a.priceCents, a]));

    return {
      ok: true as const,
      currency,
      offerCount: summary.TotalOfferCount ?? offers.offerCount ?? null,
      suggestedCents: quote.suggestedCents,
      breakevenCents: quote.breakevenCents,
      marginPct: quote.marginPct,
      prices: references.map((r) => {
        const at = r.priceCents != null ? byPrice.get(r.priceCents) ?? null : null;
        return {
          kind: r.kind,
          label: r.label,
          priceCents: r.priceCents,
          profitCents: at?.profitCents ?? null,
          profitMarginPct: at?.marginPct ?? null,
          // Below breakeven is a loss on every unit sold, which is the thing worth seeing at a
          // glance next to a price Amazon is inviting you to match.
          aboveBreakeven: at?.aboveBreakeven ?? null,
        };
      }),
    };
  }

  /**
   * Assemble the offer and ask Amazon to validate it, without creating anything.
   *
   * This is the step that answers "would this work", and it is the one to run first every time.
   */
  async preview(productId: string, integrationId: string) {
    await this.assertListingAllowed(integrationId);
    const built = await this.buildFromPlan(productId, integrationId);
    if (built.missing.length > 0) {
      return {
        ...built,
        existingListing: false,
        carriedForward: [] as string[],
        carriedFulfilmentChannels: [] as string[],
        validated: false,
        submissionStatus: null,
        issues: [],
        message: 'Fill in what is missing before validating.',
      };
    }

    // The payload is resolved against the live listing here too, not only on submit: a dry run of a
    // payload the submit would not send proves nothing about the submit.
    const payload = await this.payloadForPut(integrationId, built);
    if (!payload.ok) {
      return {
        ...built,
        existingListing: false,
        carriedForward: [] as string[],
        carriedFulfilmentChannels: [] as string[],
        validated: false,
        submissionStatus: null,
        issues: [],
        message: payload.message,
      };
    }

    const result = await this.integrations.putAmazonOffer(
      integrationId,
      built.sku,
      { productType: payload.productType, attributes: payload.attributes },
      true,
    );
    return {
      ...built,
      // The merged payload, because that is the one that would go — the preview showing a different
      // payload from the one submit sends is the failure a dry run exists to prevent.
      productType: payload.productType,
      attributes: payload.attributes,
      existingListing: payload.existing,
      carriedForward: payload.carriedForward,
      carriedFulfilmentChannels: payload.carriedFulfilmentChannels,
      validated: result.ok,
      submissionStatus: result.submissionStatus,
      issues: result.issues,
      message: result.message ?? null,
    };
  }

  /**
   * The whole body to PUT for this SKU — which is not the same question as what our plan holds.
   *
   * For a brand-new listing they are the same thing. For a SKU Amazon already holds — a re-list to
   * repair an existing listing, the common case — the plan alone would delete every attribute the
   * plan has no opinion about, because PUT replaces the whole item. So the live attributes are read
   * first and the plan laid over them.
   *
   * The product type comes from the live listing too, for the same reason: it decides which
   * attributes are even valid, and a plan filed under a different one would re-categorise the item
   * and invalidate the very attributes being carried forward. Our plan's product type only decides
   * where a listing that does not exist yet should go.
   *
   * Fails closed when the listing cannot be read: writing a replacement without knowing what is
   * being replaced is the whole fault, and a network blip is not a reason to risk it.
   */
  private async payloadForPut(
    integrationId: string,
    built: { sku: string; productType: string; attributes: Record<string, unknown> },
  ): Promise<
    | {
        ok: true;
        productType: string;
        attributes: Record<string, unknown>;
        existing: boolean;
        carriedForward: string[];
        carriedFulfilmentChannels: string[];
      }
    | { ok: false; message: string }
  > {
    const live = await this.integrations.getAmazonListingState(integrationId, built.sku);
    if (!live.ok) {
      return {
        ok: false,
        message: `Could not read the current Amazon listing for ${built.sku}, so it cannot be safely replaced: ${live.message ?? 'unknown reason'}. Nothing was sent to Amazon.`,
      };
    }
    if (!live.exists) {
      // A first listing has nothing to preserve; the plan is the whole item, as it always was.
      return {
        ok: true,
        productType: built.productType,
        attributes: built.attributes,
        existing: false,
        carriedForward: [],
        carriedFulfilmentChannels: [],
      };
    }

    const merged = mergeOverLiveAttributes(live.attributes ?? {}, built.attributes);
    // Amazon's summary is the authority on where the item is filed. Falling back to the plan only
    // covers a listing that somehow reports no product type at all.
    return { ok: true, existing: true, productType: live.productType || built.productType, ...merged };
  }

  /**
   * Create the offer for real.
   *
   * Refuses unless every gate is open, and says which one is shut. The refusal is deliberate rather
   * than a warning: this is the only step in the module that a customer can see the result of.
   */
  async submit(productId: string, integrationId: string, opts: { confirm?: boolean } = {}) {
    await this.assertListingAllowed(integrationId);
    if (!(await this.liveWritesEnabled())) {
      throw new BadRequestException(
        process.env.LISTING_LIVE_WRITES === 'false'
          ? 'Listing writes are disabled on this server by configuration. Nothing was sent to Amazon.'
          : 'Creating listings is switched off. Turn on "Create real marketplace listings" in Settings → General first. Nothing was sent to Amazon.',
      );
    }
    if (!opts.confirm) {
      throw new BadRequestException('Creating a real offer needs an explicit confirmation.');
    }

    const built = await this.buildFromPlan(productId, integrationId);
    if (built.missing.length > 0) {
      throw new BadRequestException(`Not ready to list: ${built.missing.map((m) => m.label).join(', ')}`);
    }
    if (!built.eligible) {
      throw new BadRequestException(`This product may not be sold on ${built.marketplace}: ${built.eligibilityReasons.join('; ')}`);
    }

    // What Amazon already holds for this SKU decides the payload: our plan replaces the whole item,
    // so anything the plan does not know about has to be carried forward or it is deleted.
    const payload = await this.payloadForPut(integrationId, built);
    if (!payload.ok) throw new BadRequestException(payload.message);
    if (payload.existing) {
      if (payload.productType !== built.productType) {
        this.logger.log(
          `Re-listing existing SKU ${built.sku} under Amazon's own product type ${payload.productType}, not the plan's ${built.productType}`,
        );
      }
      this.logger.log(
        `Re-listing existing SKU ${built.sku}: carrying forward ${payload.carriedForward.length} attribute(s)` +
          `${payload.carriedForward.length ? ` (${payload.carriedForward.join(', ')})` : ''}` +
          `${payload.carriedFulfilmentChannels.length ? ` and fulfilment channels ${payload.carriedFulfilmentChannels.join(', ')}` : ''}`,
      );
    }

    // Validate immediately before submitting rather than trusting an earlier preview: prices,
    // stock and the catalogue all move, and a preview from ten minutes ago proves nothing now.
    const check = await this.integrations.putAmazonOffer(
      integrationId,
      built.sku,
      { productType: payload.productType, attributes: payload.attributes },
      true,
    );
    if (!check.ok) {
      throw new BadRequestException(`Amazon rejected the offer in validation: ${check.issues[0]?.message ?? check.message ?? 'unknown reason'}`);
    }

    const result = await this.integrations.putAmazonOffer(
      integrationId,
      built.sku,
      { productType: payload.productType, attributes: payload.attributes },
      false,
    );

    if (result.ok) {
      // ACCEPTED is not live. Amazon processes asynchronously and can still reject, so the plan
      // records that we submitted, not that it worked — `status` is confirmed by a later read.
      await this.prisma.productChannelPlan.updateMany({
        where: { productId, integrationId },
        data: { status: 'SUBMITTED', listedAt: new Date() },
      });
      this.logger.log(`Offer submitted: ${built.sku} -> ${built.asin} on ${built.marketplace}`);
    }

    return {
      ok: result.ok,
      sku: built.sku,
      asin: built.asin,
      existingListing: payload.existing,
      productType: payload.productType,
      carriedForward: payload.carriedForward,
      carriedFulfilmentChannels: payload.carriedFulfilmentChannels,
      submissionStatus: result.submissionStatus,
      issues: result.issues,
      message: result.message ?? null,
    };
  }

  /** What Amazon says about the listing now — the only way to tell accepted from actually live. */
  async state(productId: string, integrationId: string) {
    const built = await this.buildFromPlan(productId, integrationId).catch(() => null);
    if (!built) throw new NotFoundException('No plan for this product on this channel');
    return this.integrations.getAmazonListingState(integrationId, built.sku);
  }

  /**
   * Gather everything the offer needs from the product, its plan and the channel.
   *
   * One place, so preview and submit can never build different payloads from the same data — the
   * failure mode that makes a dry run worthless.
   */
  private async buildFromPlan(productId: string, integrationId: string) {
    const [product, integration, plan] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        include: {
          hazmatClassRef: { select: { code: true } },
          voltageRating: { select: { numericMin: true, numericMax: true } },
          frequency: { select: { code: true } },
          plugTypeRef: { select: { code: true } },
        },
      }),
      this.prisma.channelIntegration.findFirst({
        where: { id: integrationId, deletedAt: null },
        select: { id: true, name: true, channelType: true, marketplace: true },
      }),
      this.prisma.productChannelPlan.findFirst({ where: { productId, integrationId, deletedAt: null } }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!integration) throw new NotFoundException('Channel not found');
    if (integration.channelType !== 'amazon') throw new BadRequestException('This flow is for Amazon channels');
    if (!plan) throw new BadRequestException('Prepare the channel plan on the product card first');
    if (!plan.categoryRef) throw new BadRequestException('The plan has no Amazon product type set');

    const listing = await this.prisma.channelListing.findFirst({
      where: { integrationId, productId },
      select: { channelSku: true, listedPrice: true, currency: true, asin: true },
    });

    // Our own SKU is the listing's identity on Amazon. An existing channel listing wins, because
    // re-listing under a new SKU would create a second offer beside the one already there.
    const sku = listing?.channelSku ?? product.mainSku;
    const availability = await this.prisma.productAvailability.findUnique({
      where: { productId },
      select: { quantity: true },
    });

    // Availability owns sellable stock. Where a product has none recorded, fall back to what we are
    // already publishing on another Amazon marketplace — it is the last figure we told Amazon we
    // held, and it beats refusing to quote. The source travels with it so the underlying gap stays
    // visible rather than being papered over by a number that appeared from nowhere.
    let quantity = availability?.quantity ?? null;
    let quantitySource: 'availability' | 'sibling-listing' | 'none' = availability ? 'availability' : 'none';
    if (quantity == null) {
      const sibling = await this.prisma.channelListing.findFirst({
        where: {
          productId,
          listedQuantity: { not: null },
          // Never borrow from another company's account: their FBA quantity is Amazon-controlled
          // stock we do not hold, and publishing it as ours would oversell.
          integration: { channelType: 'amazon', deletedAt: null, ...(await fullScopeIntegrationWhere(this.prisma)) },
          integrationId: { not: integrationId },
        },
        orderBy: { lastPulledAt: 'desc' },
        select: { listedQuantity: true, integration: { select: { marketplace: true } } },
      });
      if (sibling?.listedQuantity != null) {
        quantity = sibling.listedQuantity;
        quantitySource = 'sibling-listing';
      }
    }

    const input: OfferInput = {
      asin: (plan.aspects as Record<string, string> | null)?.asin ?? listing?.asin ?? '',
      marketplaceId: MARKETPLACE_IDS[(integration.marketplace ?? '').toUpperCase()] ?? '',
      currency: currencyForMarketplace(integration.marketplace, listing?.currency),
      priceCents: plan.offerPriceCents ?? (listing?.listedPrice != null ? Math.round(listing.listedPrice * 100) : null),
      quantity,
      handlingTimeDays: plan.handlingTimeDays,
      conditionType: CONDITION_CODES[plan.condition] ?? CONDITION_CODES.NEW,
      countryOfOrigin: product.countryOfOrigin,
      packageWeightKg: product.packageWeightKg == null ? null : Number(product.packageWeightKg),
      packageLengthCm: product.packageLengthCm == null ? null : Number(product.packageLengthCm),
      packageWidthCm: product.packageWidthCm == null ? null : Number(product.packageWidthCm),
      packageHeightCm: product.packageHeightCm == null ? null : Number(product.packageHeightCm),
      warrantyText: product.warrantyText,
      hazmatCode: product.hazmatClassRef?.code ?? null,
      batteryRequired: product.batteryRequired,
      merchantShippingGroup: plan.deliveryTemplate,
    };

    const { attributes, missing } = buildOfferAttributes(input);

    // Recomputed here rather than trusted from the product card: the voltage may have changed since
    // anyone last looked, and this is the last point before the offer becomes visible to customers.
    const profile = await this.prisma.marketplaceProfile.findFirst({
      where: { channelType: 'amazon', marketplace: (integration.marketplace ?? '').toUpperCase(), active: true },
    });
    const verdict = profile
      ? (() => {
          const e = evaluateEligibility(
            {
              voltageMinV: product.voltageRating?.numericMin ?? null,
              voltageMaxV: product.voltageRating?.numericMax ?? null,
              frequencyHz: product.frequency?.code ?? null,
              plugType: product.plugTypeRef?.code ?? null,
              batteryRequired: product.batteryRequired,
              hazmatClass: product.hazmatClassRef?.code ?? null,
            },
            profile as unknown as MarketProfile,
          );
          return {
            eligible: e.eligible,
            eligibilityReasons: e.findings.filter((f) => f.severity === 'block').map((f) => f.reason),
          };
        })()
      // No profile for this market means nothing was checked. Treated as ineligible rather than
      // eligible: the last gate before a customer-visible write must fail closed.
      : { eligible: false, eligibilityReasons: [`No marketplace profile for Amazon ${integration.marketplace ?? '?'} — nothing could be checked`] };

    return {
      sku,
      asin: input.asin,
      productType: plan.categoryRef,
      marketplace: integration.marketplace ?? '',
      channelName: integration.name,
      attributes,
      missing,
      quantitySource,
      ...verdict,
      liveWritesEnabled: await this.liveWritesEnabled(),
    };
  }
}

/** Amazon reports money as a decimal amount; the platform works in minor units throughout. */
interface RawPriceLike {
  ListingPrice?: { Amount?: number };
  Shipping?: { Amount?: number };
  LandedPrice?: { Amount?: number };
}

function money(amount: number | undefined): number | null {
  return amount == null || !Number.isFinite(amount) ? null : Math.round(amount * 100);
}

/**
 * The currency an offer on this marketplace must be denominated in.
 *
 * Never inferred from an existing listing: a first offer has none, and defaulting to EUR is how a
 * UK listing went live priced in euros — Amazon accepted it, stored it, and had no GBP price to
 * sell at. The marketplace is the only authority on this.
 */
export function currencyForMarketplace(iso: string | null | undefined, fallback?: string | null): string {
  const known = MARKETPLACE_CURRENCY[(iso ?? '').toUpperCase()];
  return known ?? fallback ?? 'EUR';
}

/** A marketplace has exactly one currency; quoting in the wrong one is quoting a different price. */
const MARKETPLACE_CURRENCY: Record<string, string> = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', UK: 'GBP', GB: 'GBP', IE: 'EUR', DE: 'EUR',
  FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR', SE: 'SEK', PL: 'PLN', TR: 'TRY',
  EG: 'EGP', SA: 'SAR', AE: 'AED', IN: 'INR', ZA: 'ZAR', JP: 'JPY', AU: 'AUD', SG: 'SGD',
};

/** Marketplace ids for the Amazon regions we sell on, keyed by our own ISO-style channel codes. */
const MARKETPLACE_IDS: Record<string, string> = {
  US: 'ATVPDKIKX0DER', CA: 'A2EUQ1WTGCTBG2', MX: 'A1AM78C64UM0Y8', BR: 'A2Q3Y263D00KWC',
  UK: 'A1F83G8C2ARO7P', GB: 'A1F83G8C2ARO7P', IE: 'A28R8C7NBKEWEA', DE: 'A1PA6795UKMFR9',
  FR: 'A13V1IB3VIYZZH', IT: 'APJ6JRA9NG5V4', ES: 'A1RKKUPIHCS9HS', NL: 'A1805IZSGTT6HS',
  BE: 'AMEN7PMS3EDWL', SE: 'A2NODRKZP88ZB9', PL: 'A1C3SOZRARQ6R3', TR: 'A33AVAJ2PDY3EV',
  EG: 'ARBP9OOSHTCHU', SA: 'A17E79C6D8DWNP', AE: 'A2VIGQ35RCS4UG', IN: 'A21TJRUUN4KGV',
  ZA: 'AE08WJ6YKNBMC', JP: 'A1VC38T7YXB528', AU: 'A39IBJ37TRP1C6', SG: 'A19VAU5U5O7RUS',
};
