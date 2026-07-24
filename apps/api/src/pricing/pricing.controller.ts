import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PricingService } from './pricing.service';
import { BulkPricingDto, IndividualPricingDto } from './dto/pricing.dto';

@ApiTags('pricing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pricing')
export class PricingController {
  constructor(private readonly svc: PricingService) {}

  /** Profit for one product on one channel, plus the same revenue restated everywhere else. */
  @Post('individual')
  individual(@Body() dto: IndividualPricingDto) {
    return this.svc.individual(dto);
  }

  /** Solve listing prices for a product set across channels at a target margin. */
  @Post('bulk')
  bulk(@Body() dto: BulkPricingDto) {
    return this.svc.bulk(dto);
  }

  /** Default shipping service per channel, so the wizard can show and edit it up front. */
  @Get('channel-shipping-defaults')
  channelShippingDefaults(@Query('channelIds') channelIds?: string) {
    const ids = channelIds?.split(',').map((s) => s.trim()).filter(Boolean);
    return this.svc.channelShippingDefaults(ids?.length ? ids : undefined);
  }

  /** Vendor / brand / product-type options with product counts, for the bulk picker. */
  @Get('groups')
  groups(@Query('mode') mode: 'vendor' | 'brand' | 'type') {
    return this.svc.groups(mode === 'brand' || mode === 'type' ? mode : 'vendor');
  }
}
