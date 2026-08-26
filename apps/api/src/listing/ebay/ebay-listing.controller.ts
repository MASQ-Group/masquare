import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { EbayListingService, type PublishArgs } from './ebay-listing.service';

/**
 * Creating an eBay listing through the Inventory API.
 *
 * Admin-only. Of the five routes here exactly one makes something a buyer can see: `publish`.
 * `prerequisites` and `preview` send nothing; `location` writes an address record rather than a
 * listing; `withdraw` is the way back.
 */
@ApiTags('listing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('listing/ebay')
export class EbayListingController {
  constructor(private readonly svc: EbayListingService) {}

  /** Policies, locations and what is missing. Read-only. */
  @Get('prerequisites')
  prerequisites(@Query('integrationId') integrationId?: string) {
    return this.svc.prerequisites(integrationId);
  }

  /**
   * Create the merchant location every offer needs.
   *
   * Also the safest check that the token carries the write scope: it creates an address record, so
   * a scope failure surfaces while there is still nothing public to undo.
   */
  @Post('location')
  createLocation(
    @Body() dto: { integrationId?: string; key: string; addressLine1: string; addressLine2?: string; city: string; postalCode: string; country: string; stateOrProvince?: string },
  ) {
    return this.svc.createLocation(dto);
  }

  /** Exactly what would be sent, and what is missing. Sends nothing to eBay. */
  @Post('products/:productId/preview')
  preview(@Body() dto: PublishArgs & { productId: string }) {
    return this.svc.preview(dto.productId, dto);
  }

  /** Creates a LIVE, publicly buyable listing. Refuses without live writes and an explicit confirm. */
  @Post('publish')
  publish(@Body() dto: PublishArgs & { productId: string; confirm?: boolean }) {
    return this.svc.publish(dto.productId, dto);
  }

  /** End a published listing. */
  @Post('withdraw')
  withdraw(@Body() dto: { offerId: string; integrationId?: string }) {
    return this.svc.withdraw(dto.offerId, dto.integrationId);
  }
}
