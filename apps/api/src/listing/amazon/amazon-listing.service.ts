import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { buildOfferAttributes, CONDITION_CODES, type OfferInput } from './offer-payload';
import { evaluateEligibility, type MarketProfile } from '../eligibility';

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
  ) {}

  /** Off unless the environment says otherwise. Absent, empty or anything but 'true' means off. */
  static liveWritesEnabled(): boolean {
    return process.env.LISTING_LIVE_WRITES === 'true';
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
        message: 'This product has no EAN or UPC. Amazon can only be searched on a unique identifier — a title match would risk attaching the offer to a different product.',
      };
    }

    const search = await this.integrations.searchAmazonCatalog(integrationId, [identifier], identifierType);
    if (!search.ok) {
      return { productId, searchedBy: { type: identifierType, value: identifier }, candidates: [], message: search.message };
    }

    // Restrictions are per ASIN, so each candidate is checked on its own. Sequential on purpose:
    // there are rarely more than a handful, and SP-API rate limits are unkind to bursts.
    const candidates: Array<{
      asin: string; productType: string | null; title: string | null; brand: string | null; imageUrl: string | null;
      restricted: boolean | null;
      restrictionReasons: Array<{ message: string; reasonCode: string | null; linkUrl: string | null }>;
      restrictionError: string | null;
    }> = [];
    for (const item of search.items) {
      const restrictions = await this.integrations.getAmazonListingRestrictions(integrationId, item.asin);
      candidates.push({
        ...item,
        restricted: restrictions.ok ? restrictions.restricted : null,
        restrictionReasons: restrictions.reasons,
        restrictionError: restrictions.ok ? null : restrictions.message ?? null,
      });
    }

    return {
      productId,
      searchedBy: { type: identifierType, value: identifier },
      candidates,
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
  async sweepMarketplaces(productId: string, ctx?: { setTotal(n: number): void; tick(ok?: boolean): void; note(m: string): void }) {
    const integrations = await this.prisma.channelIntegration.findMany({
      where: { deletedAt: null, channelType: 'amazon' },
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
        notFound: results.filter((r) => !r.found && !r.alreadyListed && !r.error).length,
        failed: results.filter((r) => r.error && !r.found && !r.alreadyListed).length,
      },
    };
  }

  /**
   * Assemble the offer and ask Amazon to validate it, without creating anything.
   *
   * This is the step that answers "would this work", and it is the one to run first every time.
   */
  async preview(productId: string, integrationId: string) {
    const built = await this.buildFromPlan(productId, integrationId);
    if (built.missing.length > 0) {
      return { ...built, validated: false, submissionStatus: null, issues: [], message: 'Fill in what is missing before validating.' };
    }

    const result = await this.integrations.putAmazonOffer(
      integrationId,
      built.sku,
      { productType: built.productType, attributes: built.attributes },
      true,
    );
    return {
      ...built,
      validated: result.ok,
      submissionStatus: result.submissionStatus,
      issues: result.issues,
      message: result.message ?? null,
    };
  }

  /**
   * Create the offer for real.
   *
   * Refuses unless every gate is open, and says which one is shut. The refusal is deliberate rather
   * than a warning: this is the only step in the module that a customer can see the result of.
   */
  async submit(productId: string, integrationId: string, opts: { confirm?: boolean } = {}) {
    if (!AmazonListingService.liveWritesEnabled()) {
      throw new BadRequestException('Live listing writes are switched off on this server. Nothing was sent to Amazon.');
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

    // Validate immediately before submitting rather than trusting an earlier preview: prices,
    // stock and the catalogue all move, and a preview from ten minutes ago proves nothing now.
    const check = await this.integrations.putAmazonOffer(
      integrationId,
      built.sku,
      { productType: built.productType, attributes: built.attributes },
      true,
    );
    if (!check.ok) {
      throw new BadRequestException(`Amazon rejected the offer in validation: ${check.issues[0]?.message ?? check.message ?? 'unknown reason'}`);
    }

    const result = await this.integrations.putAmazonOffer(
      integrationId,
      built.sku,
      { productType: built.productType, attributes: built.attributes },
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

    const input: OfferInput = {
      asin: (plan.aspects as Record<string, string> | null)?.asin ?? listing?.asin ?? '',
      marketplaceId: MARKETPLACE_IDS[(integration.marketplace ?? '').toUpperCase()] ?? '',
      currency: listing?.currency ?? 'EUR',
      priceCents: listing?.listedPrice != null ? Math.round(listing.listedPrice * 100) : null,
      quantity: availability?.quantity ?? null,
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
      ...verdict,
      liveWritesEnabled: AmazonListingService.liveWritesEnabled(),
    };
  }
}

/** Marketplace ids for the Amazon regions we sell on, keyed by our own ISO-style channel codes. */
const MARKETPLACE_IDS: Record<string, string> = {
  US: 'ATVPDKIKX0DER', CA: 'A2EUQ1WTGCTBG2', MX: 'A1AM78C64UM0Y8', BR: 'A2Q3Y263D00KWC',
  UK: 'A1F83G8C2ARO7P', GB: 'A1F83G8C2ARO7P', IE: 'A28R8C7NBKEWEA', DE: 'A1PA6795UKMFR9',
  FR: 'A13V1IB3VIYZZH', IT: 'APJ6JRA9NG5V4', ES: 'A1RKKUPIHCS9HS', NL: 'A1805IZSGTT6HS',
  BE: 'AMEN7PMS3EDWL', SE: 'A2NODRKZP88ZB9', PL: 'A1C3SOZRARQ6R3', TR: 'A33AVAJ2PDY3EV',
  EG: 'ARBP9OOSHTCHU', SA: 'A17E79C6D8DWNP', AE: 'A2VIGQ35RCS4UG', IN: 'A21TJRUUN4KGV',
  ZA: 'AE08WJ6YKNBMC', JP: 'A1VC38T7YXB528', AU: 'A39IBJ37TRP1C6', SG: 'A19VAU5U5O7RUS',
};
