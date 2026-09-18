import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessArea, RequireCapability } from '../access/access.decorators';
import { CustomerShipmentsService, type FulfilInput } from './customer-shipments.service';
import type { ShipmentForm } from './shipment-form';

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

  /**
   * What the form needs to be drawn for one customer: their saved goods, and the battery list.
   *
   * One request rather than two, and the customer's own catalogue rather than the platform's — a
   * shipment filed for them by us should offer exactly what they would have been offered filing it
   * themselves, or the two routes produce different shipments from the same telephone call.
   *
   * Declared above `:id` because Nest matches in declaration order: below it, "form-options" is
   * read as a shipment id, and the route answers nothing while looking like it works. It did
   * exactly that for one run against a real server, which is how it was found.
   */
  @Get('form-options')
  formOptions(@Query('customerId') customerId?: string) {
    return this.shipments.formOptions(customerId ?? '');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.shipments.get(id);
  }

  /**
   * File one on a customer's behalf — the telephone call, or the email, that never reaches the
   * portal.
   *
   * Takes the same form the customer's own screen submits, checked by the same rules. A shorter
   * form for us would be a second set of rules about what a shipment needs, and the two would
   * drift; what arrives in the queue is then indistinguishable from one they filed themselves,
   * which is the point.
   */
  @Post()
  file(@Body() body: { customerId?: string } & ShipmentForm, @CurrentUser() user: AuthUser) {
    const { customerId, ...form } = body ?? ({} as { customerId?: string } & ShipmentForm);
    return this.shipments.fileForm(customerId ?? '', form, user.sub);
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

  /** Ask the carrier where this parcel is, now. */
  @Post(':id/refresh-tracking')
  refreshTracking(@Param('id') id: string) {
    return this.shipments.refreshTracking(id);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string) {
    return this.shipments.reopen(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.shipments.cancel(id);
  }

  /**
   * Remove one that should never have existed — a test, a duplicate, the wrong customer.
   *
   * Behind the delete capability rather than plain edit rights: erasing a record and correcting one
   * are different decisions, and the person who works the queue all day needs the second far more
   * often than the first.
   */
  @Delete(':id')
  @RequireCapability('delete_records')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.shipments.remove(id, user.sub);
  }
}
