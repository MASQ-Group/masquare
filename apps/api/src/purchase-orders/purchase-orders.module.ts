import { Module } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import { CostingService } from './costing.service';
import { CostingReadService } from './costing-read.service';
import { VendorReturnsService } from './vendor-returns.service';
import { VendorReturnsController } from './vendor-returns.controller';
import { CostingController } from './costing.controller';
import { PdfService } from './pdf/pdf.service';
import { GoodsReceiptsController, PurchaseOrdersController } from './purchase-orders.controller';
import { WarehousesModule } from '../warehouses/warehouses.module';

@Module({
  // Receiving moves stock, so it needs the warehouses module's StockService.
  imports: [WarehousesModule],
  controllers: [PurchaseOrdersController, GoodsReceiptsController, CostingController, VendorReturnsController],
  providers: [CostingService, CostingReadService, VendorReturnsService, PurchaseOrdersService, GoodsReceiptsService, PdfService],
  exports: [PurchaseOrdersService, GoodsReceiptsService, CostingService, VendorReturnsService],
})
export class PurchaseOrdersModule {}
