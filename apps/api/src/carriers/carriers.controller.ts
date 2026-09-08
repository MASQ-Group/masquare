import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CarriersService, type CarrierAccountInput } from './carriers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AllowedCompanies, VisibleCompanies } from '../common/active-company.decorator';
import { AccessArea, RequireCapability } from '../access/access.decorators';

/**
 * Carrier accounts.
 *
 * Filed under the integrations area: it is the same job — connecting the platform to somebody
 * else's system with somebody else's keys — even though a courier is not a marketplace.
 *
 * Every write needs manage_credentials, including the ones that look harmless. Changing an account
 * number or an environment decides which account gets billed and which host is called, which is the
 * same class of decision as replacing a key.
 */
@ApiTags('carriers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('carriers')
@AccessArea('integrations')
export class CarriersController {
  constructor(private readonly svc: CarriersService) {}

  @Get('accounts')
  list(@VisibleCompanies() companyIds: string[]) {
    return this.svc.list(companyIds);
  }

  @Get('accounts/:id')
  get(@Param('id') id: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.get(id, companyIds);
  }

  /**
   * Writes are checked against every company the user MAY reach, not the one they are looking at.
   *
   * `visibleIds` narrows to the active company — it is a view filter, and reads use it so a list
   * respects the company switcher. Using it here confused a filter with a permission: it refused to
   * create an account for a company the user is perfectly entitled to, purely because a different
   * one happened to be selected in the switcher. `allowedIds` is the permission, and it is what a
   * write has to be measured against.
   */
  @Post('accounts')
  @RequireCapability('manage_credentials')
  create(@Body() body: CarrierAccountInput, @CurrentUser() user: AuthUser, @AllowedCompanies() companyIds: string[]) {
    return this.svc.create(body, user.sub, companyIds);
  }

  @Patch('accounts/:id')
  @RequireCapability('manage_credentials')
  update(
    @Param('id') id: string,
    @Body() body: Partial<CarrierAccountInput>,
    @CurrentUser() user: AuthUser,
    @AllowedCompanies() companyIds: string[],
  ) {
    return this.svc.update(id, body, user.sub, companyIds);
  }

  @Delete('accounts/:id')
  @RequireCapability('manage_credentials')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @AllowedCompanies() companyIds: string[]) {
    return this.svc.remove(id, user.sub, companyIds);
  }

  /**
   * Authenticate with the stored keys and record what happened.
   *
   * Needs manage_credentials rather than being open to anyone who can see the page: it spends a
   * request against an endpoint that bans us for ten minutes if pressed too often, and the ban is
   * per IP, so it would land on every company at once.
   */
  @Post('accounts/:id/test')
  @RequireCapability('manage_credentials')
  test(@Param('id') id: string, @CurrentUser() user: AuthUser, @AllowedCompanies() companyIds: string[]) {
    return this.svc.test(id, user.sub, companyIds);
  }

  /**
   * Ask FedEx what a shipment would cost, and return the reply untouched.
   *
   * The response is deliberately unmapped: FedEx ships sample requests but no sample responses, so
   * nobody here has seen the shape of a reply yet. This is how we get one — from FedEx rather than
   * from a guess — and the mapper goes in afterwards.
   *
   * Rating is not the throttled endpoint (that is the token), so this needs no special protection
   * beyond the account being one the caller may reach.
   */
  @Post('accounts/:id/rate-quote')
  rateQuote(
    @Param('id') id: string,
    @Body() body: any,
    @AllowedCompanies() companyIds: string[],
  ) {
    return this.svc.rateQuote(id, body ?? {}, companyIds);
  }
}
