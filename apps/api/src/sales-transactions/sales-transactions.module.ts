import { Module } from '@nestjs/common';
import { SalesTransactionsService } from './sales-transactions.service';
import { SalesTransactionsController } from './sales-transactions.controller';
import { WarehousesModule } from '../warehouses/warehouses.module';

@Module({
  // Serial-tracked sales consume stock, so this needs the warehouses services.
  imports: [WarehousesModule],
  controllers: [SalesTransactionsController],
  providers: [SalesTransactionsService],
  exports: [SalesTransactionsService],
})
export class SalesTransactionsModule {}
