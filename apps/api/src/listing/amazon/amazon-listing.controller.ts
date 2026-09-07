import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { AmazonListingService } from './amazon-listing.service';
import { JobsService } from '../../jobs/jobs.service';
import { AccessArea, RequireCapability, Requires } from '../../access/access.decorators';
import { VisibleCompanies } from '../../common/active-company.decorator';
import { CurrentUser, type AuthUser } from '../../common/current-user.decorator';

/**
 * Creating an Amazon offer on an existing listing.
 *
 * Admin-only, and only `submit` can write to Amazon — everything else asks Amazon questions or
 * validates without creating. `submit` additionally refuses unless the server env allows live
 * writes and the caller confirms.
 */
@ApiTags('listing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('listing/amazon')
@AccessArea('channel_listings')
export class AmazonListingController {
  constructor(
    private readonly svc: AmazonListingService,
    private readonly jobs: JobsService,
  ) {}

  /** Whether a real offer could be created at all, so the UI can say so before anyone tries. */
  @Get('status')
  async status() {
    // Two independent gates, reported separately: listing creation and changing one price are
    // different acts, and a screen must be able to tell which of them it may perform.
    const [liveWritesEnabled, priceWritesEnabled] = await Promise.all([
      this.svc.liveWritesEnabled(),
      this.svc.priceWritesEnabled(),
    ]);
    return { liveWritesEnabled, priceWritesEnabled };
  }

  /** Search Amazon's catalogue by our EAN/UPC and report what may be offered on. Read-only. */
  @Get('products/:productId/channels/:integrationId/candidates')
  candidates(@Param('productId') productId: string, @Param('integrationId') integrationId: string) {
    return this.svc.findCandidates(productId, integrationId);
  }

  /**
   * Search every Amazon marketplace for this product. Read-only, and a job because it is slow.
   * Returns the job to follow; the result lands on it when the sweep finishes.
   */
  @Post('products/:productId/sweep')
  sweep(
    @Param('productId') productId: string,
    @VisibleCompanies() companyIds: string[],
    @Body() body: { withPricing?: boolean } = {},
  ) {
    // Pricing doubles the calls per candidate marketplace, so it is asked for rather than assumed:
    // the product card wants a fast "where does this exist", the listings page wants "and would it pay".
    const withPricing = body.withPricing === true;
    return this.jobs.start(
      'listing.amazon.sweep',
      withPricing ? 'Checking every Amazon marketplace' : 'Searching Amazon marketplaces',
      (ctx) => this.svc.sweepMarketplaces(productId, ctx, { withPricing, companyIds }),
    );
  }

  /**
   * The launch price for this product here, and what a given price would earn.
   *
   * Read-only apart from one live fee estimate. POST because it takes a price to evaluate.
   */
  @Post('products/:productId/channels/:integrationId/quote')
  @Requires('view')
  quote(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @Body() body: { atPricesCents?: number[] } = {},
  ) {
    return this.svc.quote(productId, integrationId, body.atPricesCents ?? []);
  }

  /**
   * What the competition charges for this ASIN, with what each of those prices would earn us.
   *
   * Read-only and deliberately without a "match" action: the point is to inform the number a human
   * types, not to hand over the decision. On the blender that prompted this, the featured offer was
   * a third of our suggested price — a chip saying what that would lose is the whole value.
   */
  @Get('products/:productId/channels/:integrationId/competition')
  competition(@Param('productId') productId: string, @Param('integrationId') integrationId: string) {
    return this.svc.competition(productId, integrationId);
  }

  /** Build the offer and have Amazon validate it. Creates nothing. */
  @Post('products/:productId/channels/:integrationId/preview')
  @Requires('view')
  preview(@Param('productId') productId: string, @Param('integrationId') integrationId: string) {
    return this.svc.preview(productId, integrationId);
  }

  /**
   * What "list on every eligible marketplace at N%" would do, before it does anything.
   *
   * Read-only, and POST because it takes a margin. Company-scoped: without it, a product could be
   * previewed — and then listed — against the other company's seller accounts.
   */
  @Post('products/:productId/list-everywhere/preview')
  @Requires('view')
  listEverywherePreview(
    @Param('productId') productId: string,
    @VisibleCompanies() companyIds: string[],
    @Body() body: { marginPct?: number; handlingForAll?: number | string | null; handlingByChannel?: Record<string, number | string | null> } = {},
  ) {
    return this.svc.listEverywherePreview(productId, body.marginPct, companyIds, {
      applyToAll: body.handlingForAll,
      perChannel: body.handlingByChannel,
    });
  }

  /**
   * Create the offers, on the marketplaces named and no others.
   *
   * A job, because it fans out across marketplaces and each one is a validate-then-write round trip.
   * The marketplaces are sent explicitly rather than re-derived, so what is acted on is what
   * somebody agreed to.
   */
  @Post('products/:productId/list-everywhere')
  @RequireCapability('marketplace_write')
  listEverywhere(
    @Param('productId') productId: string,
    @VisibleCompanies() companyIds: string[],
    @Body()
    body: {
      marginPct?: number;
      integrationIds?: string[];
      confirm?: boolean;
      handlingForAll?: number | string | null;
      handlingByChannel?: Record<string, number | string | null>;
      /** A price chosen for one marketplace, overriding the margin-derived suggestion. */
      priceByChannel?: Record<string, number | string | null>;
    } = {},
  ) {
    const count = body.integrationIds?.length ?? 0;
    return this.jobs.start(
      'listing.amazon.listEverywhere',
      `Listing on ${count} marketplace${count === 1 ? '' : 's'}`,
      (ctx) =>
        this.svc.listEverywhere(
          productId,
          body.marginPct,
          body.integrationIds ?? [],
          { confirm: body.confirm },
          companyIds,
          ctx,
          // The same handling times the preview was taken with, so what is written is what was
          // shown. Sent rather than remembered server-side: nothing here is stateful between the
          // two calls, and a remembered value is one that can go stale between them.
          { applyToAll: body.handlingForAll, perChannel: body.handlingByChannel },
          { perChannel: body.priceByChannel },
        ),
    );
  }

  /**
   * Confirm which Amazon listing this product is, on one marketplace.
   *
   * One channel per call, on purpose. There is no bulk equivalent and there should not be: the
   * check this represents is a person looking at a title and an image and saying "yes, that one".
   */
  @Post('products/:productId/channels/:integrationId/match')
  matchChannel(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @VisibleCompanies() companyIds: string[],
    @CurrentUser() user: AuthUser,
    @Body() body: { asin: string; productType?: string | null },
  ) {
    return this.svc.matchChannel(productId, integrationId, body, user.sub, companyIds);
  }

  /** Undo a match, so a wrong one can be corrected. */
  @Post('products/:productId/channels/:integrationId/unmatch')
  unmatchChannel(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @VisibleCompanies() companyIds: string[],
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.unmatchChannel(productId, integrationId, user.sub, companyIds);
  }

  /** The alternatives, when the stored suggestion is not the right listing. Read-only. */
  @Get('products/:productId/channels/:integrationId/match-candidates')
  @Requires('view')
  matchCandidates(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @VisibleCompanies() companyIds: string[],
  ) {
    return this.svc.matchCandidates(productId, integrationId, companyIds);
  }

  /** The only call in this module that creates an offer. Gated three ways. */
  @Post('products/:productId/channels/:integrationId/submit')
  @RequireCapability('marketplace_write')
  submit(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @Body() body: { confirm?: boolean } = {},
  ) {
    return this.svc.submit(productId, integrationId, body);
  }

  /** What Amazon says about the listing now — accepted is not the same as live. */
  /**
   * Adopt a seller SKU for this marketplace and record it as an alias of the product.
   *
   * Reached only after Amazon has refused the product's own SKU in validation. The name is the
   * operator's to choose - ours is a starting point they can edit.
   */
  @Post('products/:productId/channels/:integrationId/use-sku')
  useSku(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @Body() body: { sku: string },
    @CurrentUser() user: AuthUser,
    @VisibleCompanies() companyIds: string[],
  ) {
    return this.svc.useSku(productId, integrationId, body?.sku, user.sub, companyIds);
  }

  /** What a price would earn, and what we would suggest. Read-only. */
  @Get('products/:productId/channels/:integrationId/price-check')
  priceCheck(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @VisibleCompanies() companyIds: string[],
    @Query('atPriceCents') atPriceCents?: string,
  ) {
    const at = atPriceCents ? Number(atPriceCents) : null;
    return this.svc.priceCheck(productId, integrationId, Number.isFinite(at) ? at : null, companyIds);
  }

  /**
   * Change one listing's price on the channel.
   *
   * Its own gate (channelPriceWrites / CHANNEL_PRICE_WRITES), independent of listing creation and
   * of the repricing engine's bulk writes. Without `confirm` it validates and changes nothing.
   */
  @Post('products/:productId/channels/:integrationId/price')
  updatePrice(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @VisibleCompanies() companyIds: string[],
    @Body() body: { priceCents: number; confirm?: boolean },
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.updatePrice(productId, integrationId, Number(body?.priceCents), { confirm: body?.confirm }, user.sub, companyIds);
  }

  @Get('products/:productId/channels/:integrationId/state')
  state(@Param('productId') productId: string, @Param('integrationId') integrationId: string) {
    return this.svc.state(productId, integrationId);
  }
}
