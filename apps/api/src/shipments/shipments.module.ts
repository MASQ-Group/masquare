import { Module } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { WarehousesModule } from '../warehouses/warehouses.module';

@Module({
  // For StockService: a replacement despatch moves stock, and that must go through the same
  // ledger every other movement uses rather than a write of its own.
  imports: [WarehousesModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
