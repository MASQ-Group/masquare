import { Body, Controller, Delete, ForbiddenException, Get, Header, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies, WriteCompany } from '../common/active-company.decorator';
import { PurchaseOrdersService, type PurchaseOrderQuery } from './purchase-orders.service';
import { GoodsReceiptsService, type GoodsReceiptQuery } from './goods-receipts.service';
import { AmendPurchaseOrderDto, CancelPurchaseOrderDto, CreatePurchaseOrderDto, DecideUnlockDto, RequestUnlockDto, UnlockPurchaseOrderDto, UpdatePurchaseOrderDto } from './dto/purchase-order.dto';
import { CancelGoodsReceiptDto, PostGoodsReceiptDto } from './dto/goods-receipt.dto';
import { AccessArea } from '../access/access.decorators';

@ApiTags('purchase-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('purchase-orders')
@AccessArea('purchasing')
export class PurchaseOrdersController {
  constructor(
    private readonly svc: PurchaseOrdersService,
    private readonly receipts: GoodsReceiptsService,
  ) {}

  @Get()
  list(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: PurchaseOrderQuery = { q, status, vendorId, companyIds, from, to, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.svc.list(query);
  }

  // --- Unlock requests (literal paths declared before ":id") ---

  @Get('unlock-requests')
  listUnlockRequests(@CurrentUser() user: AuthUser) {
    if (!user.isAdmin) throw new ForbiddenException('Admin only');
    return this.svc.listUnlockRequests();
  }

  @Post('unlock-requests/:requestId/decide')
  decideUnlock(@Param('requestId') requestId: string, @Body() dto: DecideUnlockDto, @CurrentUser() user: AuthUser) {
    if (!user.isAdmin) throw new ForbiddenException('Admin only');
    return this.svc.decideUnlock(requestId, dto.grant, user.sub, dto.note);
  }

  /** Every PO id matching a filter — for "select all matching" in the list. */
  @Get('ids')
  ids(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.allIds({ q, status, vendorId, companyIds, from, to });
  }

  /** Submit many drafts in one go; non-drafts are skipped with a reason. */
  @Post('bulk/submit')
  bulkSubmit(@Body() body: { ids: string[] }, @CurrentUser() user: AuthUser) {
    return this.svc.bulkSubmit(body?.ids ?? [], user.sub);
  }

  @Post()
  create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: AuthUser, @WriteCompany() companyId: string) {
    return this.svc.create(dto, user.sub, companyId);
  }

  @Get(':id')
  get(@Param('id') id: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.get(id, companyIds);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.update(id, dto, user.sub, companyIds);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.submit(id, user.sub, companyIds);
  }

  /**
   * Admin amendment of an order that has already been received. Quantities may only go
   * up, or down as far as what has already arrived — anything beyond that is a return.
   */
  @Post(':id/amend')
  amend(@Param('id') id: string, @Body() dto: AmendPurchaseOrderDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    if (!user.isAdmin) throw new ForbiddenException('Only an admin can amend a received purchase order');
    return this.svc.amend(id, dto, user.sub, companyIds);
  }

  /** Admins only — everyone else must go through :id/unlock-request. */
  @Post(':id/unlock')
  unlock(@Param('id') id: string, @Body() dto: UnlockPurchaseOrderDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    if (!user.isAdmin) throw new ForbiddenException('Only an admin can unlock a purchase order');
    return this.svc.unlock(id, user.sub, dto.note, companyIds);
  }

  @Post(':id/unlock-request')
  requestUnlock(@Param('id') id: string, @Body() dto: RequestUnlockDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.requestUnlock(id, user.sub, dto.reason, companyIds);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelPurchaseOrderDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.cancel(id, dto.reason, user.sub, companyIds);
  }

  /** Branded PDF of the order, ready to send to the vendor. */
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response, @VisibleCompanies() companyIds: string[]) {
    const { filename, pdf } = await this.svc.renderPdf(id, companyIds);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }

  /** Every goods receipt raised against this PO (PR10). */
  @Get(':id/receipts')
  receiptsFor(@Param('id') id: string) {
    return this.receipts.forPurchaseOrder(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.remove(id, user.sub, companyIds);
  }
}

@ApiTags('goods-receipts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('goods-receipts')
@AccessArea('purchasing')
export class GoodsReceiptsController {
  constructor(private readonly svc: GoodsReceiptsService) {}

  @Get()
  list(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('purchaseOrderId') purchaseOrderId?: string,
    @Query('vendorId') vendorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: GoodsReceiptQuery = {
      q, status, purchaseOrderId, vendorId, companyIds, from, to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.svc.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.get(id, companyIds);
  }

  /** Record what arrived: moves stock, updates the PO and raises any backorder. */
  @Post(':id/post')
  post(@Param('id') id: string, @Body() dto: PostGoodsReceiptDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.post(id, dto, user.sub, companyIds);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelGoodsReceiptDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.cancel(id, dto?.reason, user.sub, companyIds);
  }
}
