import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { JobsService } from '../jobs/jobs.service';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies } from '../common/active-company.decorator';
import { AvailabilityService, type AvailabilityQuery } from './availability.service';
import { SetAvailabilityDto } from './dto/availability.dto';
import { AccessArea } from '../access/access.decorators';

@ApiTags('availability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('availability')
// Availability is derived from products and is granted with them.
@AccessArea('products')
export class AvailabilityController {
  constructor(
    private readonly svc: AvailabilityService,
    private readonly jobs: JobsService,
  ) {}

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

  /**
   * Put many products into availability at zero, so they can be counted.
   *
   * Declared before ':productId'. Without confirm it reports what it would add and writes nothing;
   * with confirm it returns a job, since onboarding a whole catalogue outlives a request.
   */
  @Post('bulk-add')
  bulkAdd(@Body() dto: { productIds?: string[]; listedOnly?: boolean; confirm?: boolean }, @CurrentUser() user: AuthUser) {
    if (!dto?.confirm) return this.svc.bulkAdd({ ...dto, confirm: false }, user.sub);
    return this.jobs.start(
      'availability.bulk-add',
      'Adding products to availability',
      (ctx) => this.svc.bulkAdd({ ...dto, confirm: true }, user.sub, ctx),
    );
  }

  /**
   * Company scope is passed because this now carries channel data. Availability itself is one
   * shared pool per product, but the pushes and listings beside it belong to a company's
   * integration and must not be read across that line.
   */
  /**
   * The reconcile worklist: products whose channels disagree with what we hold.
   *
   * Declared before ':productId' — Nest matches in order, so a literal path defined after a
   * parameterised one is never reached and 'drift' would be read as a product id.
   */
  @Get('drift')
  drift(
    @VisibleCompanies() companyIds: string[],
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.drift({ companyIds, page: Number(page) || 1, pageSize: Number(pageSize) || 50 });
  }

  @Get(':productId')
  get(@Param('productId') productId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.get(productId, companyIds);
  }

  @Post(':productId')
  setQuantity(@Param('productId') productId: string, @Body() dto: SetAvailabilityDto, @CurrentUser() user: AuthUser) {
    return this.svc.setQuantity(productId, dto.quantity, dto.note ?? null, user.sub);
  }
}
