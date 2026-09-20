import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies } from '../common/active-company.decorator';
import { AccessArea } from '../access/access.decorators';
import { JiniusOrdersService } from './jinius-orders.service';

/**
 * Jinius orders and the local transaction that invoices them.
 *
 * Under the sales-transactions area: these orders exist to become one, and whoever may see the
 * revenue is the person who should see the orders behind it. Nothing here writes to Jinius.
 */
@ApiTags('jinius')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('jinius/orders')
@AccessArea('sales_transactions')
export class JiniusOrdersController {
  constructor(private readonly svc: JiniusOrdersService) {}

  /** The orders we hold, newest first. */
  @Get()
  list(
    @VisibleCompanies() companyIds: string[],
    @Query('integrationId') integrationId?: string,
    @Query('linked') linked?: 'yes' | 'no',
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list({ integrationId, companyIds, linked, q, limit: limit ? Number(limit) : undefined });
  }

  /** Pull orders from Jinius and settle availability. Reads from the marketplace, writes only here. */
  @Post('sync')
  sync(
    @Body() body: { integrationId?: string; sinceDays?: number },
    @CurrentUser() user: AuthUser,
    @VisibleCompanies() companyIds: string[],
  ) {
    return this.svc.sync({ integrationId: body?.integrationId, sinceDays: body?.sinceDays, companyIds, actorId: user.sub });
  }

  /** Unlinked Jinius sales for the "Jinius Order ID" box on a local sale, priced as that sale prices them. */
  @Get('unlinked')
  unlinked(@VisibleCompanies() companyIds: string[], @Query('q') q?: string, @Query('limit') limit?: string) {
    return this.svc.unlinkedForPicker({ q, limit: limit ? Number(limit) : undefined, companyIds });
  }

  /** What the local transaction would carry for a selection. Writes nothing. */
  @Post('local-sale/preview')
  preview(@Body() body: { orderIds?: string[] }, @VisibleCompanies() companyIds: string[]) {
    return this.svc.previewLocalSale(body?.orderIds ?? [], companyIds);
  }

  /** Create that transaction, as a draft for somebody to review and submit. */
  @Post('local-sale')
  create(
    @Body() body: { orderIds?: string[]; salesChannelId?: string; date?: string; transactionRef?: string },
    @CurrentUser() user: AuthUser,
    @VisibleCompanies() companyIds: string[],
  ) {
    return this.svc.createLocalSale(body?.orderIds ?? [], {
      salesChannelId: body?.salesChannelId ?? '',
      date: body?.date,
      transactionRef: body?.transactionRef,
      companyIds,
      actorId: user.sub,
    });
  }

  /** Point orders at a transaction that already exists — for sales invoiced before this was built. */
  @Post('link')
  link(
    @Body() body: { orderIds?: string[]; transactionId?: string },
    @CurrentUser() user: AuthUser,
    @VisibleCompanies() companyIds: string[],
  ) {
    return this.svc.link(body?.orderIds ?? [], body?.transactionId ?? '', { companyIds, actorId: user.sub });
  }

  @Post('unlink')
  unlink(@Body() body: { orderIds?: string[] }, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.unlink(body?.orderIds ?? [], { companyIds, actorId: user.sub });
  }
}
