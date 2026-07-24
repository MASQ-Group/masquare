import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VendorReturnsService } from './vendor-returns.service';
import { CreateVendorReturnDto } from './dto/vendor-return.dto';

@ApiTags('vendor-returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vendor-returns')
export class VendorReturnsController {
  constructor(private readonly svc: VendorReturnsService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('vendorId') vendorId?: string,
    @Query('purchaseOrderId') purchaseOrderId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list({
      q, vendorId, purchaseOrderId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** What is still returnable against a PO, line by line. Drives the return form. */
  @Get('returnable/:purchaseOrderId')
  returnable(@Param('purchaseOrderId') purchaseOrderId: string) {
    return this.svc.returnableForPo(purchaseOrderId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  /** Posts immediately: stock out, cost out at average, PO reopened if it was closed. */
  @Post()
  create(@Body() dto: CreateVendorReturnDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user.sub);
  }
}
