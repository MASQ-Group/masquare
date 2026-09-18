import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessArea, RequireCapability } from '../access/access.decorators';
import { CustomersService, type ContactInput, type CustomerInput } from './customers.service';
import { CustomerUsersService } from './customer-users.service';

/** The companies we provide services to, what they take from us, and the people at each. */
@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customers')
@AccessArea('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly users: CustomerUsersService,
  ) {}

  @Get()
  list(@Query('q') q?: string, @Query('active') active?: string, @Query('type') type?: string) {
    return this.customers.list({ q, active, type: type?.trim() || undefined });
  }

  /** The services a customer can take. Declared before `:id`, which would otherwise swallow it. */
  @Get('types')
  types() {
    return this.customers.types();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Post()
  create(@Body() dto: CustomerInput, @CurrentUser() user: AuthUser) {
    return this.customers.create(dto ?? {}, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: CustomerInput, @CurrentUser() user: AuthUser) {
    return this.customers.update(id, dto ?? {}, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.customers.remove(id, user.sub);
  }

  // ── their people, who sign in to the portal ──────────────────────────────────────────────────

  @Get(':id/users')
  listUsers(@Param('id') id: string) {
    return this.users.list(id);
  }

  /** Creates the login and emails the invitation. The person chooses their own password. */
  @Post(':id/users')
  createUser(@Param('id') id: string, @Body() dto: { fullName?: string; email?: string }, @CurrentUser() user: AuthUser) {
    return this.users.create(id, dto ?? {}, user.sub);
  }

  /** Send the invitation again. Any outstanding link is superseded. */
  @Post(':id/users/:userId/invite')
  reinvite(@Param('id') id: string, @Param('userId') userId: string, @CurrentUser() user: AuthUser) {
    return this.users.invite(id, userId, user.sub);
  }

  @Patch(':id/users/:userId')
  updateUser(@Param('id') id: string, @Param('userId') userId: string, @Body() dto: { fullName?: string; status?: string }) {
    return this.users.update(id, userId, dto ?? {});
  }

  @Delete(':id/users/:userId')
  removeUser(@Param('id') id: string, @Param('userId') userId: string) {
    return this.users.remove(id, userId);
  }

  @Post(':id/contacts')
  addContact(@Param('id') id: string, @Body() dto: ContactInput) {
    return this.customers.addContact(id, dto ?? {});
  }

  @Patch(':id/contacts/:contactId')
  updateContact(@Param('id') id: string, @Param('contactId') contactId: string, @Body() dto: ContactInput) {
    return this.customers.updateContact(id, contactId, dto ?? {});
  }

  @Delete(':id/contacts/:contactId')
  removeContact(@Param('id') id: string, @Param('contactId') contactId: string) {
    return this.customers.removeContact(id, contactId);
  }

  /**
   * Start their shipment numbering again from one.
   *
   * Behind the delete capability, although it deletes nothing. What it does is make a number that
   * has already been used available again, and every consequence of getting that wrong looks like
   * the consequences of a bad delete: two shipments a customer cannot tell apart on a telephone
   * call. The same people should hold both.
   */
  @Post(':id/reset-numbering')
  @RequireCapability('delete_records')
  resetNumbering(@Param('id') id: string) {
    return this.customers.resetNumbering(id);
  }
}
