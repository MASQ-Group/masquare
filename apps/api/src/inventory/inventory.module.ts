import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { WarehousesModule } from '../warehouses/warehouses.module';

@Module({
  // StockService supplies on-hand availability; the rest is queried directly.
  imports: [WarehousesModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
