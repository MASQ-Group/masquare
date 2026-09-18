import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { PortalRoute } from '../access/access.decorators';
import { PortalService, type ProductInput } from './portal.service';
import { PortalGuard, PortalCustomer } from './portal.guard';
import type { ShipmentForm } from '../customer-shipments/shipment-form';

/**
 * The customer portal.
 *
 * Its own controller, its own guard, its own service — nothing here is shared with the platform's
 * screens. That separation is the point: a customer's people reach exactly these routes and no
 * others, and every one of them is scoped to the customer they belong to by the guard rather than
 * by a parameter anybody could change.
 *
 * `@PortalRoute()` marks these as theirs. The global access guard refuses portal accounts
 * everywhere else, including on routes that skip the area check.
 */
@ApiTags('portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PortalGuard)
@PortalRoute()
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  /** Who they are and what their lists hold — the shell reads this on every load. */
  @Get('home')
  home(@PortalCustomer() customerId: string) {
    return this.portal.home(customerId);
  }

  /**
   * The countries list, for the address picker.
   *
   * The portal cannot reach the platform's own countries route — external accounts are refused
   * everywhere outside here, which is why the picker came up empty and its search found nothing —
   * so it serves the same table itself. Reference data, with no customer of ours in it.
   */
  @Get('countries')
  countries() {
    return this.portal.countries();
  }

  @Get('shipments')
  list(@PortalCustomer() customerId: string, @Query('view') view?: string, @Query('q') q?: string) {
    return this.portal.list(customerId, { view, q });
  }

  @Get('shipments/:id')
  get(@PortalCustomer() customerId: string, @Param('id') id: string) {
    return this.portal.get(customerId, id);
  }

  @Post('shipments')
  file(@PortalCustomer() customerId: string, @CurrentUser() user: AuthUser, @Body() form: ShipmentForm) {
    if (!form) throw new BadRequestException('Nothing was submitted.');
    return this.portal.file(customerId, user.sub, form);
  }

  /** Correct one still with us. `resubmit` answers a question we sent back. */
  @Patch('shipments/:id')
  update(
    @PortalCustomer() customerId: string,
    @Param('id') id: string,
    @Body() body: ShipmentForm & { resubmit?: boolean },
  ) {
    const { resubmit, ...form } = body ?? ({} as ShipmentForm & { resubmit?: boolean });
    return this.portal.update(customerId, id, form, { resubmit: resubmit === true });
  }

  @Post('shipments/:id/cancel')
  cancel(@PortalCustomer() customerId: string, @Param('id') id: string) {
    return this.portal.cancel(customerId, id);
  }

  @Post('shipments/:id/archive')
  archive(@PortalCustomer() customerId: string, @Param('id') id: string) {
    return this.portal.archive(customerId, id);
  }

  // ── their own catalogue of goods ─────────────────────────────────────────────────────────────

  @Get('products')
  products(@PortalCustomer() customerId: string) {
    return this.portal.products(customerId);
  }

  @Post('products')
  createProduct(@PortalCustomer() customerId: string, @CurrentUser() user: AuthUser, @Body() body: ProductInput) {
    return this.portal.saveProduct(customerId, null, body ?? {}, user.sub);
  }

  @Patch('products/:id')
  updateProduct(@PortalCustomer() customerId: string, @Param('id') id: string, @Body() body: ProductInput) {
    return this.portal.saveProduct(customerId, id, body ?? {});
  }

  @Delete('products/:id')
  removeProduct(@PortalCustomer() customerId: string, @Param('id') id: string) {
    return this.portal.removeProduct(customerId, id);
  }
}
