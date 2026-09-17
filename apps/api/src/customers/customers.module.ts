import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { CustomerUsersService } from './customer-users.service';
import { InvitesController } from './invites.controller';

/** Logistics customers: the tenants of the customer portal. */
@Module({
  controllers: [CustomersController, InvitesController],
  providers: [CustomersService, CustomerUsersService],
  exports: [CustomersService, CustomerUsersService],
})
export class CustomersModule {}
