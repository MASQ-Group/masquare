import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { buildOfferAttributes, CONDITION_CODES, mergeOverLiveAttributes, type OfferInput } from './offer-payload';
import { evaluateEligibility, type MarketProfile } from '../eligibility';
import { FloorService } from '../../amazon-repricing/floor/floor.service';
import { fullScopeIntegrationWhere, isOrdersOnlyCompany } from '../../common/amazon-scope';
import { suggestSku } from './sku-suggestion';
import { isSkuInUseRejection } from './sku-collision';
import { readValidation } from './validation-gate';
import { ListingService } from '../listing.service';
import { recordAvailability } from '../availability/availability-record';
import { decimalsFor, isExpressible, priceAmountFor, roundPriceCents } from '../../common/currency-precision';
import { parseChannelPrice, parseHandlingDays, parseMarginPct, verdictFor, type BulkChannelFacts, type BulkHandlingInput, type BulkPriceInput } from './bulk-listing';
import { restrictionFor, restrictionReason } from '../brand-restrictions';

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
    // The one writer of channel plans. Bulk listing sets a price and a handling time before
    // submitting, and doing that with a raw upsert here would skip the validation and the readiness
    // recompute every other path goes through.
    private readonly listing: ListingService,
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
      select: { id: true, name: true, marketplace: true, targetCompanyId: true },
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
      imageUrl: string | null;
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
      /**
       * Amazon was asked and would not say. Distinct from competitive: null, which also covers
       * "not asked" — a card cannot warn about a silence it cannot see.
       */
      competitionUnavailable: boolean;
      competitionMessage: string | null;
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
          imageUrl: top?.imageUrl ?? null,
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
                // Not asked, which is not the same as asked-and-refused.
                competitionUnavailable: false, competitionMessage: null,
              }),
        });
        ctx?.tick(true);
      } catch (e) {
        // One marketplace failing must not lose the seventeen that worked.
        results.push({
          integrationId: integration.id, name: integration.name, marketplace: integration.marketplace ?? '',
          found: false, asin: null, productType: null, title: null, imageUrl: null,
          restricted: null, restrictionReason: null, error: (e as Error)?.message ?? 'Search failed',
          alreadyListed: !!live,
          listedSku: live?.channelSku ?? null,
          currency: currencyForMarketplace(integration.marketplace),
          featuredPriceCents: null, featuredProfitCents: null, featuredMarginPct: null,
          lowestPriceCents: null, competitive: null,
          competitionUnavailable: false, competitionMessage: null,
        });
        ctx?.tick(false);
      }
    }

    // The same answers the background sweep stores, stored by the same function.
    //
    // Someone pressing the button is asking Amazon the question the schedule asks; leaving the reply
    // only in this response would mean the page forgets it on reload AND the scheduler re-asks it
    // tomorrow, spending the call twice for one fact. Best-effort: a failure to file the answer must
    // not lose the answer the caller is waiting for.
    await this.storeSweep(productId, integrations, results, !!opts.withPricing).catch((e) =>
      this.logger.warn(`Could not store availability from the manual sweep: ${(e as Error)?.message ?? e}`),
    );

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
        /**
         * Marketplaces where the competition could not be read.
         *
         * Counted separately because it is the one number that says the sweep is incomplete. Left
         * out, a throttled run looks like a finished one that simply found less.
         */
        competitionUnavailable: results.filter((r) => r.competitionUnavailable).length,
        failed: results.filter((r) => r.error && !r.found && !r.alreadyListed).length,
      },
    };
  }

  /**
   * File what a manual sweep learnt, so it counts as a check.
   *
   * Marketplaces we are already listed on are skipped: the sweep does not ask Amazon about those —
   * `alreadyListed` is read from our own listings table — so there is no reply to store, and writing
   * a fabricated "not found" for them would be worse than writing nothing.
   */
  private async storeSweep(
    productId: string,
    integrations: Array<{ id: string; marketplace: string | null; targetCompanyId: string | null }>,
    results: Array<{
      integrationId: string; found: boolean; asin: string | null; productType: string | null;
      title: string | null; imageUrl: string | null; restricted: boolean | null;
      restrictionReason: string | null; error: string | null; alreadyListed: boolean;
      competitive?: boolean | null; featuredPriceCents?: number | null;
      featuredMarginPct?: number | null; currency?: string | null;
      competitionUnavailable?: boolean;
    }>,
    /**
     * Whether this run priced at all.
     *
     * Passed rather than inferred from the rows: a run that priced and found no featured offer
     * produces exactly the same nulls as a run that never asked, and only one of those should
     * overwrite a stored verdict.
     */
    priced: boolean,
  ): Promise<void> {
    for (const r of results) {
      if (r.alreadyListed) continue;
      const integration = integrations.find((i) => i.id === r.integrationId);
      if (!integration?.targetCompanyId) continue;
      await recordAvailability(
        this.prisma,
        {
          productId,
          integrationId: r.integrationId,
          companyId: integration.targetCompanyId,
          marketplace: integration.marketplace ?? '',
        },
        {
          found: r.found, asin: r.asin, productType: r.productType, title: r.title, imageUrl: r.imageUrl,
          restricted: r.restricted, restrictionReason: r.restrictionReason, error: r.error,
        },
        'manual',
        // Only where this row was actually priced. Rows the sweep skips — restricted, not found —
        // never had the offers call made for them, so they have nothing to say about competition.
        priced && (r.competitive != null || r.featuredPriceCents != null || r.competitionUnavailable)
          ? {
              competitive: r.competitive ?? null,
              featuredPriceCents: r.featuredPriceCents ?? null,
              featuredMarginPct: r.featuredMarginPct ?? null,
              currency: r.currency ?? null,
            }
          : undefined,
      );
    }
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

  async quote(productId: string, integrationId: string, atPricesCents?: number[], marginOverride?: number) {
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

    /**
     * The ASIN fees are quoted against.
     *
     * The plan is the first source, because that is where a listing being PREPARED records its
     * match. But a product already selling on the channel usually has no plan at all — its listing
     * came from the sync, not from our listing flow — and its ASIN sits on the listing record.
     * Reading only the plan meant the price of a live listing could not be quoted, which is exactly
     * the listing whose price someone wants to change.
     */
    const planAsin = ((plan?.aspects as Record<string, string> | null) ?? {}).asin;
    const listedAsin = planAsin
      ? null
      : (await this.prisma.channelListing.findFirst({
          where: { productId, integrationId, asin: { not: null } },
          select: { asin: true },
        }))?.asin ?? null;
    const asin = planAsin ?? listedAsin;
    if (!asin) throw new BadRequestException('Match an Amazon listing first — fees are quoted against the ASIN');

    const iso = (integration.marketplace ?? '').toUpperCase();
    const marketplaceId = MARKETPLACE_IDS[iso];
    if (!marketplaceId) throw new BadRequestException(`Unknown marketplace ${iso}`);

    /**
     * The platform's launch margin, unless the caller named one.
     *
     * The override exists for "list everywhere at N%", where the whole point is one margin chosen
     * for this run rather than the standing default. Passed as a fraction, and only used when it is
     * a real positive number so a stray 0 or NaN cannot quietly price a listing at breakeven.
     */
    const marginPct = marginOverride != null && Number.isFinite(marginOverride) && marginOverride > 0
      ? marginOverride
      : Number(settings?.launchMarginPct ?? 20) / 100;

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
   * Every seller SKU this company already uses on Amazon, plus the catalogue's own names.
   *
   * Used ONLY to keep a proposed alternative from colliding in turn - being refused twice, the
   * second time on a name the platform chose itself, would be worse than offering nothing. It is
   * not evidence about what Amazon will accept, and nothing reads it that way.
   */
  private async skusInUse(integrationId: string): Promise<string[]> {
    const integration = await this.prisma.channelIntegration.findFirst({
      where: { id: integrationId, deletedAt: null },
      select: { targetCompanyId: true },
    });
    const companyId = integration?.targetCompanyId ?? undefined;
    const [listings, aliases] = await Promise.all([
      this.prisma.channelListing.findMany({
        where: { integration: { channelType: 'amazon', deletedAt: null, ...(companyId ? { targetCompanyId: companyId } : {}) } },
        select: { channelSku: true },
      }),
      this.prisma.productSkuAlias.findMany({ where: { deletedAt: null }, select: { skuValue: true } }),
    ]);
    return [...listings.map((l) => l.channelSku), ...aliases.map((a) => a.skuValue)].filter(Boolean);
  }
  /**
   * Adopt a different seller SKU for this marketplace, and record it as an alias of the product.
   *
   * Only ever reached after Amazon has actually refused the product's own SKU. Nothing here decides
   * that a new name is needed — Amazon does, in validation, and the operator chooses whether to
   * accept the name offered or type their own.
   *
   * The alias is the point of doing this server-side. A listing created as RE-S8540-AU is a real
   * SKU that Amazon will quote in orders, reports and returns, and a SKU the catalogue does not
   * recognise is a sale that cannot be matched to a product. Creating the alias in the same
   * transaction as the plan means the two can never disagree: there is no window where a listing
   * exists under a name the platform has never heard of.
   *
   * Recorded as FBM because that is what this flow creates — an offer we ship ourselves. An FBA
   * offer for the same SKU is a separate decision, made when stock is actually sent to Amazon.
   */
  async useSku(productId: string, integrationId: string, sku: string, actorId?: string, companyIds?: string[]) {
    const clean = (sku ?? '').trim();
    if (!clean) throw new BadRequestException('A SKU is required');
    // Amazon's own limit. Longer is silently rejected, which reads as the listing simply failing.
    if (clean.length > 40) throw new BadRequestException('Amazon seller SKUs are at most 40 characters');

    const [product, integration] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, mainSku: true } }),
      this.prisma.channelIntegration.findFirst({
        where: { id: integrationId, deletedAt: null, channelType: 'amazon', ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}) },
        select: { id: true, marketplace: true },
      }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!integration) throw new NotFoundException('Channel not found');

    // A SKU is unique across the catalogue. Claimed by a DIFFERENT product it must not be taken —
    // two products sharing a SKU is how a sale gets attributed to the wrong one.
    const claimed = await this.prisma.productSkuAlias.findFirst({
      where: { skuValue: { equals: clean, mode: 'insensitive' } },
      select: { id: true, productId: true, deletedAt: true },
    });
    if (claimed && claimed.productId !== productId) {
      throw new BadRequestException(`${clean} is already an alias of another product`);
    }
    const takenAsMain = await this.prisma.product.findFirst({
      where: { mainSku: { equals: clean, mode: 'insensitive' }, id: { not: productId }, deletedAt: null },
      select: { id: true },
    });
    if (takenAsMain) throw new BadRequestException(`${clean} is another product's main SKU`);

    // FBM by code, so a renamed fulfilment type does not silently break the link.
    const fbm = await this.prisma.fulfilmentType.findFirst({
      where: { code: { equals: 'FBM', mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });

    const label = integration.marketplace ? `Amazon ${integration.marketplace}` : 'Amazon';

    await this.prisma.$transaction(async (tx) => {
      await tx.productChannelPlan.updateMany({
        where: { productId, integrationId, deletedAt: null },
        data: { channelSku: clean, updatedById: actorId ?? null },
      });

      if (clean.toLowerCase() === product.mainSku.toLowerCase()) return; // the main SKU needs no alias

      if (claimed) {
        // Revives a previously removed alias rather than colliding with its unique skuValue.
        await tx.productSkuAlias.update({
          where: { id: claimed.id },
          data: { productId, label, fulfilmentTypeId: fbm?.id ?? null, deletedAt: null },
        });
        return;
      }
      await tx.productSkuAlias.create({
        data: { productId, skuValue: clean, label, fulfilmentTypeId: fbm?.id ?? null },
      });
    });

    return {
      sku: clean,
      aliasCreated: clean.toLowerCase() !== product.mainSku.toLowerCase(),
      fulfilment: fbm ? 'FBM' : null,
      /** Said plainly: without a configured FBM type the alias is created without one. */
      warning: fbm ? null : 'No FBM fulfilment type is configured, so the alias was saved without one.',
    };
  }

  /**
   * Refuse a channel that is not the caller's.
   *
   * An integration id is enough to reach a seller account, and the two companies hold separate
   * ones. Without this, knowing an id would be enough to change a price on the other company's
   * Amazon account - which is the rule the isolation test exists to keep.
   */
  private async assertOwnChannel(integrationId: string, companyIds?: string[]): Promise<void> {
    if (!companyIds) return; // no scope supplied means an internal caller, not an unscoped request
    const mine = await this.prisma.channelIntegration.findFirst({
      where: { id: integrationId, deletedAt: null, targetCompanyId: { in: companyIds } },
      select: { id: true },
    });
    if (!mine) throw new NotFoundException('Channel not found');
  }
  /**
   * Whether ONE listing's price may be changed for real.
   *
   * Its own gate, sharing nothing with the other two. The repricing engine writes prices in bulk
   * from automation; creating a listing is a different act again. Turning on a human editing a
   * single price must not turn on either of the others, and neither must turn this on.
   *
   * CHANNEL_PRICE_WRITES=false forces it off whatever the toggle says, so a server can be made
   * incapable of changing a price regardless of who is clicking.
   */
  async priceWritesEnabled(): Promise<boolean> {
    if (process.env.CHANNEL_PRICE_WRITES === 'false') return false;
    const settings = await this.prisma.platformSettings.findFirst({ select: { channelPriceWrites: true } });
    return settings?.channelPriceWrites ?? false;
  }

  /**
   * What a price would earn, and what we would suggest instead.
   *
   * Read-only, and the same engine every other profit figure comes from — a second calculation
   * would be a second answer to the same question. Answers for the CURRENT listing price too, so
   * a card showing a loss can say what the loss is without anyone typing anything.
   */
  async priceCheck(productId: string, integrationId: string, atPriceCents?: number | null, companyIds?: string[]) {
    await this.assertListingAllowed(integrationId);
    await this.assertOwnChannel(integrationId, companyIds);
    const listing = await this.prisma.channelListing.findFirst({
      where: { productId, integrationId },
      select: { channelSku: true, listedPrice: true, currency: true },
    });
    const currentCents = listing?.listedPrice != null ? Math.round(listing.listedPrice * 100) : null;

    // Both prices in one call: each quote costs a live Amazon fee estimate, and asking twice for
    // the same cost basis is a wasted call and a chance for the two to disagree.
    const prices = [atPriceCents, currentCents].filter((p): p is number => p != null && p > 0);
    const quote = await this.quote(productId, integrationId, [...new Set(prices)]);

    if (!quote.ok) return { ok: false as const, reason: quote.reason, sku: listing?.channelSku ?? null, currentCents };

    const at = (p: number | null | undefined) => (p == null ? null : quote.at.find((a) => a.priceCents === p) ?? null);
    return {
      ok: true as const,
      sku: listing?.channelSku ?? null,
      currency: quote.currency,
      currentCents,
      /** What the price on the listing right now earns. Null when there is no listing yet. */
      current: at(currentCents),
      /** What the price the person typed would earn. Null until they type one. */
      proposed: at(atPriceCents),
      suggestedCents: quote.suggestedCents,
      breakevenCents: quote.breakevenCents,
      targetMarginPct: quote.marginPct,
      fx: quote.fx,
    };
  }

  /**
   * Change one listing's price on the channel.
   *
   * Refuses rather than silently doing nothing when the gate is off: a price that appears to have
   * been sent and was not is worse than a clear refusal, because the next person reads the card and
   * believes the marketplace agrees with it.
   *
   * Every attempt is recorded in ChannelPush — sent or not, accepted or not. A price change is the
   * kind of act somebody asks about a week later.
   */
  async updatePrice(
    productId: string,
    integrationId: string,
    priceCents: number,
    opts: { confirm?: boolean } = {},
    actorId?: string,
    companyIds?: string[],
  ) {
    await this.assertListingAllowed(integrationId);
    await this.assertOwnChannel(integrationId, companyIds);
    if (!Number.isFinite(priceCents) || priceCents <= 0) throw new BadRequestException('A price above zero is required');

    const [integration, listing] = await Promise.all([
      this.prisma.channelIntegration.findFirst({
        where: { id: integrationId, deletedAt: null, channelType: 'amazon' },
        select: { id: true, name: true, marketplace: true, targetCompanyId: true },
      }),
      this.prisma.channelListing.findFirst({
        where: { productId, integrationId },
        select: { channelSku: true, listedPrice: true, currency: true, marketplace: true },
      }),
    ]);
    if (!integration) throw new NotFoundException('Amazon channel not found');
    if (!listing) throw new BadRequestException('This product is not listed on that channel, so there is no price to change');

    const currency = listing.currency ?? currencyForMarketplace(integration.marketplace);

    /**
     * Refuse a price this currency cannot express, rather than quietly altering it.
     *
     * Amazon JP takes whole yen only. Rounding somebody's 5687.57 to 5688 behind their back means
     * the price they confirmed and the price on the marketplace are different numbers, and the
     * difference surfaces later as an inexplicable penny. The screen prevents typing it; this
     * refuses it if it arrives anyway, and says what the currency allows.
     */
    if (!isExpressible(priceCents, currency)) {
      const places = decimalsFor(currency);
      throw new BadRequestException(
        places === 0
          ? `${currency} prices are whole numbers — ${currency} ${(priceCents / 100).toFixed(2)} has decimals this marketplace will reject. Try ${currency} ${priceAmountFor(priceCents, currency)}.`
          : `${currency} prices may have at most ${places} decimal places`,
      );
    }

    const live = await this.priceWritesEnabled();
    // Validation-only unless BOTH the gate is open and the caller said so. Two independent yeses,
    // the same shape as listing creation.
    const dryRun = !(live && opts.confirm === true);

    const result = await this.integrations.patchListingsPrice(
      integrationId,
      listing.channelSku,
      priceAmountFor(priceCents, currency),
      currency,
      // No repricing backstops here: this is a person naming one price, not automation that needs
      // a floor and a ceiling to stay inside.
      { minAmount: null, maxAmount: null },
      dryRun,
    );

    await this.prisma.channelPush.create({
      data: {
        companyId: integration.targetCompanyId,
        integrationId,
        productId,
        channelSku: listing.channelSku,
        marketplace: listing.marketplace ?? '',
        field: 'price',
        requestedValue: priceCents,
        previousValue: listing.listedPrice != null ? Math.round(listing.listedPrice * 100) : null,
        ok: result.ok,
        message: result.message.slice(0, 300),
        dryRun,
        createdById: actorId ?? null,
      },
    });

    // Our own record follows only a real, accepted write. Amazon processes asynchronously, so this
    // is what we ASKED for; the next sync is what confirms it.
    if (result.ok && !dryRun) {
      await this.prisma.channelListing.updateMany({
        where: { productId, integrationId },
        data: { listedPrice: priceCents / 100, lastPushedAt: new Date() },
      });
    }

    return {
      ok: result.ok,
      dryRun,
      liveWritesEnabled: live,
      sku: listing.channelSku,
      currency,
      priceCents,
      status: result.status,
      message: result.message,
    };
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
    /**
     * `competitionUnavailable` is the whole point of this shape.
     *
     * Every "no read" used to collapse into competitive: null, which the card rendered as nothing
     * at all — visually identical to a marketplace with no competition worth mentioning. So a
     * throttled price lookup produced a card that looked like an opportunity, and the disagreement
     * only surfaced later inside the listing flow, where the featured offer turned out to be 40%
     * below our suggestion. A missing answer has to look missing.
     */
    const none = {
      currency, featuredPriceCents: null, featuredProfitCents: null, featuredProfitEurCents: null,
      featuredMarginPct: null, lowestPriceCents: null, competitive: null,
      competitionUnavailable: false, competitionMessage: null as string | null,
    };
    const marketplaceId = MARKETPLACE_IDS[iso.toUpperCase()];
    if (!marketplaceId) return none;

    const offers = await this.integrations.getAmazonItemOffers(integrationId, asin);
    if (!offers.ok) {
      return { ...none, competitionUnavailable: true, competitionMessage: offers.message ?? 'Amazon would not return offers' };
    }
    const summary = (offers.summary ?? {}) as { BuyBoxPrices?: RawPriceLike[]; LowestPrices?: RawPriceLike[] };

    const landed = (p?: RawPriceLike) => {
      const listing = money(p?.ListingPrice?.Amount);
      return listing == null ? null : listing + (money(p?.Shipping?.Amount) ?? 0);
    };
    const featured = landed(summary.BuyBoxPrices?.[0]);
    const lowest = landed(summary.LowestPrices?.[0]);
    if (featured == null) {
      // Amazon answered and there is no featured offer. A real finding — nobody currently holds the
      // Buy Box — and deliberately NOT flagged as unavailable, which would cry wolf on every
      // uncontested listing.
      return { ...none, lowestPriceCents: lowest };
    }

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
    if (!quote.ok || !quote.at[0]) {
      // We know what they charge but not what it would earn us, so "competitive" is unanswerable.
      // Reported as unavailable rather than shown as a bare price a reader would judge for
      // themselves without our costs.
      return {
        ...none, featuredPriceCents: featured, lowestPriceCents: lowest,
        competitionUnavailable: true,
        competitionMessage: quote.ok ? 'Could not price this against the competition' : quote.reason,
      };
    }

    return {
      currency,
      featuredPriceCents: featured,
      featuredProfitCents: quote.at[0].profitCents,
      featuredProfitEurCents: quote.at[0].profitEurCents,
      featuredMarginPct: quote.at[0].marginPct,
      lowestPriceCents: lowest,
      competitive: quote.at[0].aboveBreakeven,
      competitionUnavailable: false,
      competitionMessage: null,
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

    /**
     * The plan's ASIN, or the live listing's.
     *
     * Same fallback as quote(), and needed for the same reason: a product already selling here has
     * no plan — its listing came from the sync — so reading only the plan made the competition
     * unreachable for exactly the listing whose price somebody is trying to set. "Match an Amazon
     * listing first" is nonsense advice about a listing that is already matched and live.
     */
    const planAsin = ((plan?.aspects as Record<string, string> | null) ?? {}).asin;
    const asin = planAsin
      ?? (await this.prisma.channelListing.findFirst({
        where: { productId, integrationId, asin: { not: null } },
        select: { asin: true },
      }))?.asin
      ?? null;
    if (!asin) throw new BadRequestException('No Amazon listing or matched ASIN for this product here yet');

    const iso = (integration.marketplace ?? '').toUpperCase();
    const marketplaceId = MARKETPLACE_IDS[iso];
    if (!marketplaceId) throw new BadRequestException(`Unknown marketplace ${iso}`);
    const currency = MARKETPLACE_CURRENCY[iso] ?? 'EUR';

    const offers = await this.integrations.getAmazonItemOffers(integrationId, asin);
    if (!offers.ok) {
      // `throttled` separates "wait and it will work" from "this will never work", so the screen can
      // offer a retry for the first and stop pretending for the second.
      return {
        ok: false as const,
        throttled: offers.throttled === true,
        reason: offers.message ?? 'Amazon would not return offers for this listing',
      };
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
      fx: quote.fx,
      prices: references.map((r) => {
        const at = r.priceCents != null ? byPrice.get(r.priceCents) ?? null : null;
        return {
          kind: r.kind,
          label: r.label,
          priceCents: r.priceCents,
          profitCents: at?.profitCents ?? null,
          profitEurCents: at?.profitEurCents ?? null,
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
      // Offered only because Amazon actually refused the name, never in anticipation of it.
      skuSuggestion: isSkuInUseRejection(result.issues)
        ? suggestSku(built.sku, built.marketplace ?? '', await this.skusInUse(integrationId))
        : null,
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
    const verdict = readValidation(check.issues);
    if (!check.ok && verdict.blocked) {
      /**
       * A refused SKU is a recoverable refusal, and the way out has to survive the throw.
       *
       * Thrown as a plain sentence, the suggestion computed a line later was lost and the caller
       * was left with prose to parse — which is why a bulk run could report the failure but never
       * offer the fix.
       *
       * The message stays first so every existing reader is unaffected: Nest takes an exception's
       * `.message` from a `message` property on the payload. It names the BLOCKING issue rather
       * than the first one, so a reply carrying both a SKU complaint and a missing attribute
       * reports the attribute — the thing that actually has to change.
       */
      const skuInUse = verdict.skuInUse;
      throw new BadRequestException({
        message: `Amazon rejected the offer in validation: ${verdict.blockingIssues[0]?.message ?? check.message ?? 'unknown reason'}`,
        sku: built.sku,
        skuInUse,
        skuSuggestion: skuInUse
          ? suggestSku(built.sku, built.marketplace ?? '', await this.skusInUse(integrationId))
          : null,
      });
    }

    /**
     * Validation objected only to the SKU NAME — so ask Amazon for real instead of believing it.
     *
     * `VALIDATION_PREVIEW` returns 100398 for SKUs that Seller Central creates on the same
     * marketplace without complaint, and acting on that meant splitting a SKU — RE-S8540-FR — to
     * avoid a problem that did not exist. A split is permanent and every system downstream carries
     * it: orders, reports, returns.
     *
     * Nothing is lost by trying. If the real submit refuses too, the block below offers the same
     * alias it always did, on an answer that is actually final.
     */
    if (!check.ok && verdict.skuInUse) {
      this.logger.warn(
        `Validation refused ${built.sku} on ${built.marketplace} for the SKU name only ` +
          `(${check.issues.map((i) => i.code).filter(Boolean).join(', ') || 'no code'}) — submitting for real to let Amazon decide.`,
      );
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
      // Offered only because Amazon actually refused the name, never in anticipation of it.
      skuSuggestion: isSkuInUseRejection(result.issues)
        ? suggestSku(built.sku, built.marketplace ?? '', await this.skusInUse(integrationId))
        : null,
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

    /**
     * A plan holding an ASIN but no product type is a half-match, and it is repairable.
     *
     * The product card writes the ASIN unconditionally and the product type only when Amazon's
     * search happened to return one, so a candidate without a type left a plan that passes every
     * "is it matched?" test and then fails here — with a message about a field nobody was ever
     * asked for.
     *
     * Amazon's product type is its own classification OF the chosen ASIN, not a second choice, so
     * completing it from the stored availability check for this exact pair decides nothing on
     * anyone's behalf. Where no stored type exists either, the refusal now says what to do.
     */
    let categoryRef = plan.categoryRef;
    if (!categoryRef) {
      const planAsin = (plan.aspects as Record<string, string> | null)?.asin ?? null;
      const stored = planAsin
        ? await this.prisma.productChannelAvailability.findFirst({
            where: { productId, integrationId, asin: planAsin },
            select: { productType: true },
          })
        : null;
      categoryRef = stored?.productType ?? null;
      if (categoryRef) {
        await this.prisma.productChannelPlan.updateMany({
          where: { id: plan.id },
          data: { categoryRef },
        });
        this.logger.log(`Completed a half-matched plan for ${integration.name}: product type ${categoryRef}`);
      }
    }
    if (!categoryRef) {
      throw new BadRequestException(
        (plan.aspects as Record<string, string> | null)?.asin
          ? 'This marketplace is matched to an ASIN but Amazon gave no product type for it. Re-run the availability check for this marketplace, then match it again.'
          : 'This marketplace is not matched to an Amazon listing yet.',
      );
    }

    const listing = await this.prisma.channelListing.findFirst({
      where: { integrationId, productId },
      select: { channelSku: true, listedPrice: true, currency: true, asin: true },
    });

    // Our own SKU is the listing's identity on Amazon. An existing channel listing wins, because
    // re-listing under a new SKU would create a second offer beside the one already there. Next
    // comes a SKU chosen on the plan, which is how a product already sold under its mainSku
    // elsewhere gets a name Amazon will accept here (see skuCheck).
    const sku = listing?.channelSku ?? plan.channelSku ?? product.mainSku;
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
      productType: categoryRef,
      marketplace: integration.marketplace ?? '',
      channelName: integration.name,
      attributes,
      missing,
      quantitySource,
      ...verdict,
      liveWritesEnabled: await this.liveWritesEnabled(),
    };
  }

  // ---------------------------------------------------------------------------
  // Listing on every eligible marketplace at one margin
  // ---------------------------------------------------------------------------

  /**
   * What "list everywhere at N%" would actually do, before it does anything.
   *
   * The preview IS the feature. One press of the button that follows creates real, customer-visible
   * offers on up to eighteen marketplaces in several currencies, and there is no undo worth the
   * name: taking a listing down is a separate act on each one. So every channel is shown with the
   * price it would launch at, what that price earns, and - where it would be skipped - exactly why.
   *
   * Read-only. It quotes prices, which costs a live fee estimate per marketplace, and writes nothing.
   */
  async listEverywherePreview(
    productId: string,
    rawMargin: unknown,
    companyIds?: string[],
    handling: BulkHandlingInput = {},
    prices: BulkPriceInput = {},
  ) {
    const margin = parseMarginPct(rawMargin);
    if (!margin.ok) throw new BadRequestException(margin.reason);
    const marginPct = margin.marginPct;

    /**
     * Handling times the caller supplied, validated once here.
     *
     * Checked up front rather than per channel so a single bad figure is reported as itself — "9.5
     * is not a whole number of days" — instead of surfacing eighteen times as a channel that
     * mysteriously will not list.
     */
    const perChannel = new Map<string, number>();
    for (const [integrationId, raw] of Object.entries(handling.perChannel ?? {})) {
      if (raw === '' || raw == null) continue;
      const parsed = parseHandlingDays(raw);
      if (!parsed.ok) throw new BadRequestException(`Days to dispatch: ${parsed.reason}`);
      perChannel.set(integrationId, parsed.days);
    }
    /**
     * Prices the caller already has, used instead of asking Amazon again.
     *
     * The commit re-runs this preview so it acts on facts rather than on what a screen remembered.
     * That was re-quoting every marketplace, and a quote costs a live fee estimate — eleven of them
     * within a few seconds, against an endpoint that allows about one. Amazon refused four, those
     * rows lost their price, and the whole run was refused with "Amazon would not estimate fees for
     * this listing" about marketplaces that listed perfectly well by hand a minute later.
     *
     * A price that is already known does not need deriving twice. Supplying it makes the commit
     * cheap, deterministic, and identical to what was on screen.
     */
    const suppliedPrice = new Map<string, number>();
    for (const [integrationId, raw] of Object.entries(prices.perChannel ?? {})) {
      if (raw === '' || raw == null) continue;
      const parsed = parseChannelPrice(raw);
      if (!parsed.ok) throw new BadRequestException(`Price: ${parsed.reason}`);
      suppliedPrice.set(integrationId, parsed.cents);
    }

    let suppliedForAll: number | null = null;
    if (handling.applyToAll !== '' && handling.applyToAll != null) {
      const parsed = parseHandlingDays(handling.applyToAll);
      if (!parsed.ok) throw new BadRequestException(`Days to dispatch: ${parsed.reason}`);
      suppliedForAll = parsed.days;
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true, mainSku: true, title: true, brandId: true, batteryRequired: true,
        brand: { select: { name: true } },
        hazmatClassRef: { select: { code: true } },
        voltageRating: { select: { numericMin: true, numericMax: true } },
        frequency: { select: { code: true } },
        plugTypeRef: { select: { code: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const integrations = await this.prisma.channelIntegration.findMany({
      where: {
        deletedAt: null,
        channelType: 'amazon',
        ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
        ...(await fullScopeIntegrationWhere(this.prisma)),
      },
      select: { id: true, name: true, marketplace: true },
      orderBy: { marketplace: 'asc' },
    });
    const ids = integrations.map((i) => i.id);

    const [listings, availability, plans, brandRestrictions] = await Promise.all([
      this.prisma.channelListing.findMany({
        where: { productId, integrationId: { in: ids } },
        select: { integrationId: true, asin: true },
      }),
      this.prisma.productChannelAvailability.findMany({
        where: { productId, integrationId: { in: ids } },
        select: {
          integrationId: true, found: true, restricted: true, asin: true,
          productType: true, title: true, imageUrl: true, checkedAt: true,
        },
      }),
      this.prisma.productChannelPlan.findMany({
        where: { productId, deletedAt: null, integrationId: { in: ids } },
        select: {
          integrationId: true, handlingTimeDays: true, aspects: true, categoryRef: true,
          updatedAt: true, updatedById: true,
        },
      }),
      product.brandId
        ? this.prisma.brandChannelRestriction.findMany({
            where: { brandId: product.brandId, deletedAt: null },
            select: { channelType: true, marketplace: true, note: true },
          })
        : Promise.resolve([] as Array<{ channelType: string; marketplace: string; note: string | null }>),
    ]);

    /**
     * Eligibility and stock, resolved WITHOUT buildFromPlan.
     *
     * The preview used to read both out of buildFromPlan inside a catch, and buildFromPlan throws
     * the moment a plan is missing or has no product type — which is the normal state of a channel
     * nobody has listed on. Its quantity then came back null and the row was blocked with "No
     * sellable quantity recorded": a false statement about stock, standing in for the true one
     * about an unconfirmed match. Whatever is wrong here, the reader is now told which thing.
     */
    const profiles = await this.prisma.marketplaceProfile.findMany({ where: { channelType: 'amazon', active: true } });
    const technical = {
      voltageMinV: product.voltageRating?.numericMin ?? null,
      voltageMaxV: product.voltageRating?.numericMax ?? null,
      frequencyHz: product.frequency?.code ?? null,
      plugType: product.plugTypeRef?.code ?? null,
      batteryRequired: product.batteryRequired,
      hazmatClass: product.hazmatClassRef?.code ?? null,
    };

    /**
     * Sellable units, by the same rule the single-channel flow uses.
     *
     * Availability owns the number. Where a product has none recorded, fall back to what we are
     * already publishing on another Amazon marketplace — the last figure we told Amazon we held.
     * Resolved once for the product: every channel here is one we do NOT already sell on, so the
     * "not this integration" part of the rule is satisfied for all of them.
     */
    const availabilityRow = await this.prisma.productAvailability.findUnique({
      where: { productId },
      select: { quantity: true },
    });
    const siblingListing = availabilityRow
      ? null
      : await this.prisma.channelListing.findFirst({
          where: {
            productId,
            listedQuantity: { not: null },
            integration: { channelType: 'amazon', deletedAt: null, ...(await fullScopeIntegrationWhere(this.prisma)) },
          },
          orderBy: { lastPulledAt: 'desc' },
          select: { listedQuantity: true },
        });
    const sellableQuantity = availabilityRow?.quantity ?? siblingListing?.listedQuantity ?? null;

    /**
     * A handling time borrowed from any Amazon plan for this product.
     *
     * Amazon requires one and there is no honest default to invent - "2 days" chosen by us is a
     * promise made to a customer on our behalf. Copying the figure already in use on another
     * marketplace is a different thing: somebody decided it, for this product. Where none exists
     * anywhere, the channel is blocked and says so rather than being quietly given a number.
     */
    const fallbackHandling = plans.map((p) => p.handlingTimeDays).find((h) => h != null) ?? null;

    /**
     * Who last wrote each plan.
     *
     * Looked up so a matched row can say who confirmed it, not merely when. The question "did the
     * system match these by itself?" should be answerable by reading the screen; it took a database
     * query to answer the first time it was asked, and nobody should have to remember what they
     * clicked two days ago to be sure.
     */
    const authorIds = [...new Set(plans.map((pl) => pl.updatedById).filter((id): id is string => !!id))];
    const authors = new Map(
      authorIds.length
        ? (
            await this.prisma.user.findMany({
              where: { id: { in: authorIds } },
              select: { id: true, fullName: true },
            })
          ).map((u) => [u.id, u.fullName])
        : [],
    );

    /**
     * The ASIN this product's SKU is already bound to elsewhere in these accounts.
     *
     * Amazon enforces one SKU to one ASIN within a seller account and refuses a submission that
     * breaks it, in a message naming two ASINs and leaving the reader to work out which is which.
     * We hold the answer, so a suggestion that would break it is flagged before it is confirmed.
     */
    const boundAsin =
      (
        await this.prisma.channelListing.findFirst({
          where: {
            channelSku: product.mainSku,
            asin: { not: null },
            integration: { channelType: 'amazon', deletedAt: null, ...(await fullScopeIntegrationWhere(this.prisma)) },
          },
          select: { asin: true },
        })
      )?.asin ?? null;

    const rows: Array<{
      integrationId: string; name: string; marketplace: string; currency: string;
      asin: string | null; priceCents: number | null; profitCents: number | null;
      profitEurCents: number | null; handlingTimeDays: number | null;
      handlingTimeSource: 'entered' | 'all' | 'plan' | 'borrowed' | 'none';
      checkedAt: Date | null; canList: boolean; blockers: string[]; warnings: string[];
      blockedOnlyByHandlingTime: boolean; blockedOnlyByMatch: boolean;
      matched: boolean; matchedAsin: string | null; matchedAt: Date | null; matchedBy: string | null;
      matchable: boolean; readyToPrice: boolean;
      candidate: {
        asin: string; productType: string | null; title: string | null;
        imageUrl: string | null; conflictsWithBound: boolean;
      } | null;
    }> = [];

    for (const integration of integrations) {
      const listing = listings.find((l) => l.integrationId === integration.id) ?? null;
      const avail = availability.find((a) => a.integrationId === integration.id) ?? null;
      const plan = plans.find((pl) => pl.integrationId === integration.id) ?? null;
      const planAsin = ((plan?.aspects as Record<string, string> | null) ?? {}).asin ?? null;
      const asin = planAsin ?? listing?.asin ?? avail?.asin ?? null;
      const currency = currencyForMarketplace(integration.marketplace);

      // Worth pricing only where an offer is actually on the table: a quote costs a live fee
      // estimate per marketplace, and there is nothing to price for one we already sell on.
      const given = suppliedPrice.get(integration.id) ?? null;
      // Nothing to work out where the caller already knows the price. This is also the only reason
      // the commit no longer needs a live call per marketplace.
      const worthPricing = given == null && !!asin && !listing && avail?.found === true && avail?.restricted === false;
      let priceCents: number | null = given;
      let priceReason: string | null = null;
      let profitCents: number | null = null;
      let profitEurCents: number | null = null;
      if (worthPricing) {
        const quote = await this.quote(productId, integration.id, [], marginPct / 100).catch((e) => ({
          ok: false as const,
          reason: (e as Error)?.message ?? 'Could not price this marketplace',
        }));
        if (quote.ok) {
          priceCents = quote.suggestedCents;
          const at = await this.quote(productId, integration.id, [quote.suggestedCents], marginPct / 100).catch(() => null);
          profitCents = at && at.ok ? at.at[0]?.profitCents ?? null : null;
          profitEurCents = at && at.ok ? at.at[0]?.profitEurCents ?? null : null;
        } else {
          priceReason = quote.reason;
        }
      }

      /**
       * Where this channel's handling time comes from, in order of who decided it.
       *
       * A value typed for THIS channel wins, then one typed for all of them, then the plan this
       * channel already has, then one copied from another marketplace's plan for this product. The
       * order is deliberate: the most recent, most specific human decision beats an older or more
       * general one, and a borrowed figure is the last resort rather than the first.
       *
       * The source travels with the number so the screen can say a figure was copied. A handling
       * time is a promise to a customer, and one arriving from a marketplace nobody was looking at
       * deserves to be seen before it is agreed to.
       */
      const resolvedHandling =
        perChannel.get(integration.id) ?? suppliedForAll ?? plan?.handlingTimeDays ?? fallbackHandling;
      const handlingTimeSource: 'entered' | 'all' | 'plan' | 'borrowed' | 'none' =
        perChannel.has(integration.id) ? 'entered'
          : suppliedForAll != null ? 'all'
          : plan?.handlingTimeDays != null ? 'plan'
          : fallbackHandling != null ? 'borrowed'
          : 'none';

      /**
       * Matched = a person has confirmed which Amazon listing this is here.
       *
       * Both halves are required, and they are written together by the match step: the ASIN, and
       * the product type Amazon files it under. A plan carrying one without the other is not a
       * match, and submitting it fails at validation.
       */
      const planAspects = (plan?.aspects as Record<string, string> | null) ?? {};
      const matched = !!planAspects.asin && !!plan?.categoryRef;

      /**
       * What the sweep saw, offered as a suggestion for the match step. Never applied by itself.
       *
       * `conflictsWithBound` matters more than it looks: Amazon requires one seller SKU to map to
       * one ASIN across every marketplace in an account, and refuses a submission that breaks it.
       * A suggestion that would break it has to say so before somebody confirms it.
       */
      const candidate = avail?.asin
        ? {
            asin: avail.asin,
            productType: avail.productType ?? null,
            title: avail.title ?? null,
            imageUrl: avail.imageUrl ?? null,
            conflictsWithBound: !!boundAsin && avail.asin !== boundAsin,
          }
        : null;

      // Judged directly, not inferred from a plan that may not exist. No profile for a market
      // means nothing was checked, which is reported as ineligible rather than waved through.
      const profile = profiles.find((pr) => pr.marketplace === (integration.marketplace ?? '').toUpperCase());
      const elig = profile
        ? evaluateEligibility(technical, profile as unknown as MarketProfile)
        : { eligible: false, findings: [{ severity: 'block' as const, reason: `No marketplace profile for Amazon ${integration.marketplace ?? '?'} — nothing could be checked` }] };

      const restriction = restrictionFor({ channelType: 'amazon', marketplace: integration.marketplace }, brandRestrictions);
      const facts: BulkChannelFacts = {
        // No stored check is NOT "found". Nobody has asked Amazon, and creating offers in bulk is
        // the last place to assume the answer would have been yes.
        found: avail?.found ?? false,
        restricted: avail ? avail.restricted : null,
        alreadyListed: !!listing,
        eligible: elig.eligible,
        eligibilityReasons: elig.findings.filter((f) => f.severity === 'block').map((f) => f.reason),
        asin,
        matched,
        priceCents,
        priceReason: priceReason ?? (avail ? null : 'Availability here has not been checked yet'),
        quantity: sellableQuantity,
        handlingTimeDays: resolvedHandling,
        brandRestriction: restriction
          ? restrictionReason(product.brand?.name ?? null, { channelType: 'amazon', marketplace: integration.marketplace }, restriction)
          : null,
      };

      rows.push({
        integrationId: integration.id,
        name: integration.name,
        marketplace: integration.marketplace ?? '',
        currency,
        asin,
        priceCents,
        profitCents,
        profitEurCents,
        handlingTimeDays: resolvedHandling,
        handlingTimeSource,
        checkedAt: avail?.checkedAt ?? null,
        matched,
        matchedAsin: planAspects.asin ?? null,
        /**
         * When this match was last written.
         *
         * Shown because a match made two days ago and one made a moment ago look identical
         * otherwise — which is exactly what made a screen full of pre-existing matches read as
         * though the system had done them automatically. Nothing here matches automatically; this
         * is the evidence for that, on the row.
         */
        matchedAt: matched ? plan?.updatedAt ?? null : null,
        /**
         * Who confirmed it. Null where the plan predates author tracking, which is stated on screen
         * as "author not recorded" rather than left blank — a blank reads as nobody.
         */
        matchedBy: matched ? authors.get(plan?.updatedById ?? '') ?? null : null,
        /** Offered for confirmation in the match step. Applying it is always a deliberate act. */
        candidate,
        /**
         * Worth showing in the match step at all: Amazon has it, we may sell it, and nobody has
         * said which listing it is. A channel failing for any other reason belongs in the skipped
         * list, not in a queue of things to confirm.
         */
        matchable: !listing && avail?.found === true && avail?.restricted === false && elig.eligible && !matched,
        /**
         * Nothing structural stands in the way — only a price, a dispatch time or stock might.
         *
         * The price step needs this rather than `canList`. A row blocked solely by a missing
         * handling time cannot be listed, but the handling time is entered IN the price step, so
         * showing only listable rows there meant a row could never acquire the one thing it was
         * missing. That deadlock is what this flag exists to break.
         */
        readyToPrice: matched && !listing && avail?.found === true && avail?.restricted === false && elig.eligible && !!asin,
        ...verdictFor(facts),
      });
    }

    return {
      productId,
      sku: product.mainSku,
      title: product.title,
      marginPct,
      liveWritesEnabled: await this.liveWritesEnabled(),
      rows,
      boundAsin,
      /**
       * Every marketplace counted exactly once.
       *
       * These buckets partition the rows, and `total` is asserted against their sum below. The
       * previous set overlapped and left gaps — a matched row waiting only on a dispatch time
       * belonged to none of them — so the figures on screen added up to fifteen of eighteen and
       * three marketplaces simply vanished. A reader cannot audit a screen whose numbers do not
       * reconcile, and will not trust the ones that remain.
       */
      summary: {
        total: rows.length,
        /** Nothing to decide: we already sell here. */
        alreadyListed: rows.filter((r) => r.blockers.includes('Already listed here')).length,
        /** Waiting on somebody to confirm which Amazon listing they are. */
        awaitingMatch: rows.filter((r) => r.matchable).length,
        /** Matched, and needing only a price and a dispatch time. */
        readyToPrice: rows.filter((r) => r.readyToPrice && !r.canList).length,
        /** Everything present; the list button would take it. */
        ready: rows.filter((r) => r.canList).length,
        warned: rows.filter((r) => r.canList && r.warnings.length > 0).length,
        /** Everything else — and it is genuinely everything else, by subtraction. */
        blocked: rows.filter(
          (r) =>
            !r.blockers.includes('Already listed here') &&
            !r.matchable &&
            !(r.readyToPrice && !r.canList) &&
            !r.canList,
        ).length,
      },
    };
  }


  /**
   * Record that somebody has confirmed which Amazon listing this product is, on one marketplace.
   *
   * The ONLY way an ASIN reaches a plan. Deliberately one channel per call and never derived from a
   * sweep: the availability check records the first candidate Amazon returned, which is a
   * suggestion. Treating a suggestion as a decision is how an offer lands on a similar-looking
   * product and sells the wrong thing at our price — and in bulk it would do so across eighteen
   * marketplaces before anyone noticed.
   *
   * Writes the product type alongside the ASIN, because Amazon needs both and a plan carrying one
   * without the other fails at validation with a message about neither.
   */
  async matchChannel(
    productId: string,
    integrationId: string,
    dto: { asin: string; productType?: string | null },
    actorId?: string,
    companyIds?: string[],
  ) {
    await this.assertListingAllowed(integrationId);

    const asin = (dto.asin ?? '').trim().toUpperCase();
    // Amazon ASINs are ten characters. Checked because this value ends up in a live submission, and
    // a typo here attaches our offer to whatever it happens to spell.
    if (!/^[A-Z0-9]{10}$/.test(asin)) throw new BadRequestException('An ASIN is ten letters or digits');

    const integration = await this.prisma.channelIntegration.findFirst({
      where: {
        id: integrationId,
        deletedAt: null,
        channelType: 'amazon',
        ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
      },
      select: { id: true, name: true, marketplace: true },
    });
    if (!integration) throw new NotFoundException('Amazon channel not found');

    /**
     * The product type Amazon files this ASIN under.
     *
     * Taken from the caller where the match came with one, otherwise from what the availability
     * check stored for this exact pair. Never invented: submitting under the wrong product type is
     * rejected, and guessing would turn a clear refusal into a puzzling one.
     */
    let productType = (dto.productType ?? '').trim() || null;
    if (!productType) {
      const stored = await this.prisma.productChannelAvailability.findFirst({
        where: { productId, integrationId, asin },
        select: { productType: true },
      });
      productType = stored?.productType ?? null;
    }
    if (!productType) {
      throw new BadRequestException(
        'No Amazon product type for this listing. Re-run the availability check for this marketplace, or match it from the channel plan where the type can be chosen.',
      );
    }

    const existing = await this.prisma.productChannelPlan.findFirst({
      where: { productId, integrationId, deletedAt: null },
      select: { aspects: true },
    });

    await this.listing.upsertPlan(
      productId,
      integrationId,
      {
        // Merged, not replaced: aspects carry more than the ASIN and a match must not drop the rest.
        aspects: { ...(((existing?.aspects as Record<string, unknown> | null) ?? {})), asin },
        categoryRef: productType,
      },
      actorId,
      companyIds,
    );

    return { ok: true as const, integrationId, name: integration.name, asin, productType };
  }

  /**
   * Undo a match, so a wrong one can be corrected rather than lived with.
   *
   * Clears the ASIN and the product type together — half a match is not a state worth holding, and
   * leaving the product type behind would let the next match inherit a type chosen for a different
   * listing.
   */
  async unmatchChannel(productId: string, integrationId: string, actorId?: string, companyIds?: string[]) {
    await this.assertListingAllowed(integrationId);
    const existing = await this.prisma.productChannelPlan.findFirst({
      where: { productId, integrationId, deletedAt: null },
      select: { aspects: true },
    });
    const aspects = { ...(((existing?.aspects as Record<string, unknown> | null) ?? {})) };
    delete aspects.asin;
    await this.listing.upsertPlan(productId, integrationId, { aspects, categoryRef: null }, actorId, companyIds);
    return { ok: true as const, integrationId };
  }

  /**
   * The Amazon listings that could be this product, on one marketplace.
   *
   * The live version of what the availability sweep stored — used when somebody wants to see the
   * alternatives rather than confirm the suggestion. One marketplace at a time, because it is two
   * SP-API calls and the whole point is that a person is looking at this one.
   */
  async matchCandidates(productId: string, integrationId: string, companyIds?: string[]) {
    await this.assertListingAllowed(integrationId);
    // Company-scoped like every other channel read: an integration id is enough to reach a seller
    // account, so without this anyone holding one could search the other company's catalogue.
    const integration = await this.prisma.channelIntegration.findFirst({
      where: {
        id: integrationId,
        deletedAt: null,
        channelType: 'amazon',
        ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
      },
      select: { id: true },
    });
    if (!integration) throw new NotFoundException('Amazon channel not found');
    return this.findCandidates(productId, integrationId);
  }

  /**
   * Create the offers, on the marketplaces the caller accepted and no others.
   *
   * `integrationIds` is required rather than implied. Re-deriving the list here would mean the set
   * shown on screen and the set acted on were computed at different moments from data that moves:
   * a marketplace could become listable between reading and pressing, and nobody would have agreed
   * to it.
   *
   * The preview is taken again, now, and anything it will not clear is refused outright rather than
   * skipped. Between looking and pressing, stock runs out and Amazon gates brands, and a bulk
   * create that silently drops a marketplace leaves someone believing they listed on it.
   *
   * Every gate the single-listing flow enforces is enforced again per channel, because submit() is
   * what actually writes and checks them itself. This adds no shortcut past any of them.
   */
  async listEverywhere(
    productId: string,
    rawMargin: unknown,
    integrationIds: string[],
    opts: { confirm?: boolean } = {},
    companyIds?: string[],
    ctx?: { setTotal(n: number): void; tick(ok?: boolean): void; note(m: string): void },
    handling: BulkHandlingInput = {},
    prices: BulkPriceInput = {},
  ) {
    if (!opts.confirm) {
      throw new BadRequestException('Creating offers on several marketplaces needs an explicit confirmation.');
    }
    if (!Array.isArray(integrationIds) || integrationIds.length === 0) {
      throw new BadRequestException('Choose at least one marketplace to list on');
    }

    // Re-previewed WITH the same handling times, so what is validated is what will be written. A
    // preview taken without them would refuse every channel the caller has just supplied one for.
    const preview = await this.listEverywherePreview(productId, rawMargin, companyIds, handling, prices);
    const byId = new Map(preview.rows.map((r) => [r.integrationId, r]));

    const unknown = integrationIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) throw new BadRequestException('One of the chosen marketplaces is not available to this account');

    /**
     * Prices somebody typed, validated before anything is written.
     *
     * Checked here rather than per channel inside the loop so a single bad figure is reported as
     * itself, before any marketplace has been listed on. Half a run committed and half refused over
     * a typo is the worst outcome available.
     */
    const chosenPrice = new Map<string, number>();
    for (const [integrationId, raw] of Object.entries(prices.perChannel ?? {})) {
      if (raw === '' || raw == null) continue;
      const parsed = parseChannelPrice(raw);
      if (!parsed.ok) {
        const name = byId.get(integrationId)?.name ?? 'a marketplace';
        throw new BadRequestException(`Price for ${name}: ${parsed.reason}`);
      }
      const currency = byId.get(integrationId)?.currency;
      // The currency's own precision, checked not corrected — Amazon JP takes whole yen only.
      if (currency && !isExpressible(parsed.cents, currency)) {
        const name = byId.get(integrationId)?.name ?? 'a marketplace';
        throw new BadRequestException(
          `Price for ${name}: ${currency} has no decimal places — try ${priceAmountFor(parsed.cents, currency)}.`,
        );
      }
      chosenPrice.set(integrationId, parsed.cents);
    }

    const chosen = integrationIds.map((id) => byId.get(id)!);
    const refused = chosen.filter((r) => !r.canList);
    if (refused.length > 0) {
      throw new BadRequestException(
        `${refused.length} of the chosen marketplaces can no longer be listed on: ${refused
          .map((r) => `${r.name} (${r.blockers[0]})`)
          .join('; ')}`,
      );
    }

    ctx?.setTotal(chosen.length);
    const results: Array<{
      integrationId: string; name: string; ok: boolean; priceCents: number | null; message: string;
      /** Amazon refused the SKU name. Recoverable here rather than only in the single-channel flow. */
      skuInUse: boolean;
      /** The SKU Amazon refused, and one it would accept. Offered for editing, never applied alone. */
      sku: string | null;
      skuSuggestion: string | null;
    }> = [];
    for (const row of chosen) {
      ctx?.note(row.name);
      try {
        /**
         * The price written to the plan is the one that will be sent.
         *
         * A price typed for this channel wins over the margin-derived suggestion. Without this the
         * manual price field would be decorative: somebody would type a figure, agree to it in the
         * confirmation, and the marketplace would receive the suggestion instead.
         */
        const priceCents = chosenPrice.get(row.integrationId) ?? row.priceCents;
        await this.listing.upsertPlan(
          productId,
          row.integrationId,
          {
            ...(priceCents != null ? { offerPriceCents: priceCents } : {}),
            ...(row.handlingTimeDays != null ? { handlingTimeDays: row.handlingTimeDays } : {}),
          },
          undefined,
          companyIds,
        );
        const submitted = await this.submit(productId, row.integrationId, { confirm: true });
        const sent = submitted as { ok?: boolean; message?: string; sku?: string; skuSuggestion?: string | null };
        results.push({
          integrationId: row.integrationId,
          name: row.name,
          ok: sent.ok !== false,
          priceCents,
          message: sent.message ?? 'Submitted',
          // A collision can also surface on the real submit rather than in validation.
          skuInUse: !!sent.skuSuggestion,
          sku: sent.sku ?? null,
          skuSuggestion: sent.skuSuggestion ?? null,
        });
        ctx?.tick(true);
      } catch (e) {
        // One marketplace refusing must not abandon the rest, and it must be reported rather than
        // folded into a count that reads as success.
        //
        // The refusal's payload is read where there is one: a rejected SKU carries the name Amazon
        // would take, which is the difference between a dead end and a row somebody can fix.
        const payload = (typeof (e as { getResponse?: () => unknown })?.getResponse === 'function'
          ? (e as { getResponse: () => unknown }).getResponse()
          : null) as { skuInUse?: boolean; sku?: string; skuSuggestion?: string | null } | null;
        results.push({
          integrationId: row.integrationId,
          name: row.name,
          ok: false,
          priceCents: row.priceCents,
          message: (e as Error)?.message ?? 'Failed',
          skuInUse: payload?.skuInUse === true,
          sku: payload?.sku ?? null,
          skuSuggestion: payload?.skuSuggestion ?? null,
        });
        ctx?.tick(false);
      }
    }

    return {
      productId,
      marginPct: preview.marginPct,
      results,
      summary: {
        attempted: results.length,
        submitted: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        /** Refused only because the SKU name is taken — the one failure with a fix on this screen. */
        skuRefused: results.filter((r) => !r.ok && r.skuInUse).length,
      },
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
