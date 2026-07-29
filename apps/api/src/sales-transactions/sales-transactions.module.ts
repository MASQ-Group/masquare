import { Module } from '@nestjs/common';
import { SalesTransactionsService } from './sales-transactions.service';
import { SalesTransactionsController } from './sales-transactions.controller';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { AvailabilityModule } from '../availability/availability.module';

@Module({
  // Serial-tracked sales consume stock (warehouses); sell-through lowers channel Availability.
  // The channel push it schedules is resolved lazily via ModuleRef to avoid a module cycle
  // (integrations -> sales-transactions -> channel-listings -> integrations).
  imports: [WarehousesModule, AvailabilityModule],
  controllers: [SalesTransactionsController],
  providers: [SalesTransactionsService],
  exports: [SalesTransactionsService],
})
export class SalesTransactionsModule {}
