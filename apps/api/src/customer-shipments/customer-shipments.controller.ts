import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessArea } from '../access/access.decorators';
import { CustomerShipmentsService, type FulfilInput, type ShipmentInput } from './customer-shipments.service';

/**
 * Our side of a customer's shipments: the queue, and what we did with each one.
 *
 * Under Shipments rather than under Logistics customers, because this is fulfilment work — the
 * people who book parcels hold that area, and they are the ones who open these tabs. Who we take on
 * as a customer is a different decision with a different area.
 */
@ApiTags('customer-shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customer-shipments')
@AccessArea('shipments')
export class CustomerShipmentsController {
  constructor(private readonly shipments: CustomerShipmentsService) {}

  @Get()
  list(
    @Query('queue') queue?: string,
    @Query('q') q?: string,
    @Query('customerId') customerId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.shipments.list({ queue, q, customerId, take: take ? Number(take) : undefined, skip: skip ? Number(skip) : undefined });
  }

  /** Just the badge on the tab. */
  @Get('pending-count')
  async pendingCount() {
    return { pending: await this.shipments.pendingCount() };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.shipments.get(id);
  }

  /** File one on a customer's behalf — the telephone call that does not go through the portal. */
  @Post()
  file(@Body() body: { customerId: string } & ShipmentInput, @CurrentUser() user: AuthUser) {
    const { customerId, ...input } = body ?? ({} as any);
    return this.shipments.file(customerId, input, user.sub);
  }

  /** Record what was booked: carrier, tracking, our cost and their charge. */
  @Post(':id/fulfil')
  fulfil(@Param('id') id: string, @Body() body: FulfilInput, @CurrentUser() user: AuthUser) {
    return this.shipments.fulfil(id, body ?? {}, user.sub);
  }

  @Patch(':id')
  amend(@Param('id') id: string, @Body() body: FulfilInput, @CurrentUser() user: AuthUser) {
    return this.shipments.amend(id, body ?? {}, user.sub);
  }

  /** Send it back with a question. It returns to the customer's list for them to answer. */
  @Post(':id/request-info')
  requestInfo(@Param('id') id: string, @Body() body: { question?: string }) {
    return this.shipments.requestInfo(id, body?.question ?? '');
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string) {
    return this.shipments.reopen(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.shipments.cancel(id);
  }
}
