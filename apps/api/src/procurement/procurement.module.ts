import { Module } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { ProcurementController } from './procurement.controller';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';

@Module({
  // Stock availability for the chips, and the PO service for bulk generation.
  imports: [WarehousesModule, PurchaseOrdersModule],
  controllers: [ProcurementController],
  providers: [ProcurementService],
  exports: [ProcurementService],
})
export class ProcurementModule {}
