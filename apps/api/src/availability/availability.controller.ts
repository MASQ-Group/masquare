import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AvailabilityService, type AvailabilityQuery } from './availability.service';
import { SetAvailabilityDto } from './dto/availability.dto';

const isTrue = (v?: string) => v === 'true' || v === '1';

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
    @Query('unset') unset?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: AvailabilityQuery = {
      q, brandId, vendorId, productTypeId,
      unset: unset == null ? undefined : isTrue(unset),
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.svc.list(query);
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
