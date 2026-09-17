import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessArea } from '../access/access.decorators';
import { CustomersService, type ContactInput, type CustomerInput } from './customers.service';

/** The companies we provide logistics services to, and the people to speak to at each. */
@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customers')
@AccessArea('logistics_customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query('q') q?: string, @Query('active') active?: string) {
    return this.customers.list({ q, active });
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
}
