import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AvailabilityService, type AvailabilityQuery } from './availability.service';
import { SetAvailabilityDto } from './dto/availability.dto';

@ApiTags('availability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly svc: AvailabilityService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('brandId') brandId?: string,
    @Query('vendorId') vendorId?: string,
    @Query('productTypeId') productTypeId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: AvailabilityQuery = {
      q, brandId, vendorId, productTypeId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.svc.list(query);
  }

  // Literal path before ":productId": every product id matching the filter (for "select all N").
  @Get('ids')
  ids(
    @Query('q') q?: string,
    @Query('brandId') brandId?: string,
    @Query('vendorId') vendorId?: string,
    @Query('productTypeId') productTypeId?: string,
  ) {
    const query: AvailabilityQuery = { q, brandId, vendorId, productTypeId };
    return this.svc.listIds(query);
  }

  /**
   * Empty availability so it can be rebuilt from figures someone vouches for. Admin only.
   *
   * Declared before ':productId' so 'purge' is not read as a product id. Without confirm it reports
   * what it would remove and changes nothing.
   */
  @Post('purge')
  @UseGuards(AdminGuard)
  purge(@Body() dto: { confirm?: boolean }, @CurrentUser() user: AuthUser) {
    return this.svc.purgeAll({ confirm: dto?.confirm }, user.sub);
  }

  /** The onboarding worklist: SKUs listed on a channel with no availability row. */
  @Get('missing')
  missing(
    @Query('q') q?: string,
    @Query('channelType') channelType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.missingFromAvailability({
      q, channelType,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':productId')
  get(@Param('productId') productId: string) {
    return this.svc.get(productId);
  }

  @Post(':productId')
  setQuantity(@Param('productId') productId: string, @Body() dto: SetAvailabilityDto, @CurrentUser() user: AuthUser) {
    return this.svc.setQuantity(productId, dto.quantity, dto.note ?? null, user.sub);
  }
}
