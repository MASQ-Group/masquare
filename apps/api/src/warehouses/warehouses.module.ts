import { Module } from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { StockService } from './stock.service';
import { SerialsService } from './serials.service';
import { SerialsController } from './serials.controller';
import { TransfersService } from './transfers.service';
import { AdjustmentsService } from './adjustments.service';
import { AdjustmentsController, StockController, TransfersController, WarehousesController } from './warehouses.controller';

@Module({
  controllers: [WarehousesController, StockController, SerialsController, TransfersController, AdjustmentsController],
  providers: [WarehousesService, StockService, SerialsService, TransfersService, AdjustmentsService],
  // StockService is exported so procurement/receiving can move stock later
  // without duplicating the movement-log contract.
  exports: [WarehousesService, StockService, SerialsService, TransfersService, AdjustmentsService],
})
export class WarehousesModule {}
