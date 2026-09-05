import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { AmazonListingService } from './amazon-listing.service';
import { JobsService } from '../../jobs/jobs.service';
import { AccessArea, RequireCapability, Requires } from '../../access/access.decorators';
import { VisibleCompanies } from '../../common/active-company.decorator';

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
    return { liveWritesEnabled: await this.svc.liveWritesEnabled() };
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
  @Get('products/:productId/channels/:integrationId/state')
  state(@Param('productId') productId: string, @Param('integrationId') integrationId: string) {
    return this.svc.state(productId, integrationId);
  }
}
