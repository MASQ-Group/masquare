import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { AmazonListingService } from './amazon-listing.service';
import { JobsService } from '../../jobs/jobs.service';

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
  sweep(@Param('productId') productId: string) {
    return this.jobs.start('listing.amazon.sweep', 'Searching Amazon marketplaces', (ctx) =>
      this.svc.sweepMarketplaces(productId, ctx),
    );
  }

  /**
   * The launch price for this product here, and what a given price would earn.
   *
   * Read-only apart from one live fee estimate. POST because it takes a price to evaluate.
   */
  @Post('products/:productId/channels/:integrationId/quote')
  quote(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @Body() body: { atPriceCents?: number | null } = {},
  ) {
    return this.svc.quote(productId, integrationId, body.atPriceCents ?? null);
  }

  /** Build the offer and have Amazon validate it. Creates nothing. */
  @Post('products/:productId/channels/:integrationId/preview')
  preview(@Param('productId') productId: string, @Param('integrationId') integrationId: string) {
    return this.svc.preview(productId, integrationId);
  }

  /** The only call in this module that creates an offer. Gated three ways. */
  @Post('products/:productId/channels/:integrationId/submit')
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
