import { Module } from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { StockService } from './stock.service';
import { SerialsService } from './serials.service';
import { SerialsController } from './serials.controller';
import { StockController, WarehousesController } from './warehouses.controller';

@Module({
  controllers: [WarehousesController, StockController, SerialsController],
  providers: [WarehousesService, StockService, SerialsService],
  // StockService is exported so procurement/receiving can move stock later
  // without duplicating the movement-log contract.
  exports: [WarehousesService, StockService, SerialsService],
})
export class WarehousesModule {}
