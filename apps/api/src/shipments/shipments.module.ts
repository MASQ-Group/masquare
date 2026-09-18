import { Module } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { CarriersModule } from '../carriers/carriers.module';
import { OrderBookingService } from './order-booking.service';

@Module({
  // For StockService: a replacement despatch moves stock, and that must go through the same
  // ledger every other movement uses rather than a write of its own.
  // CarriersModule for booking an order with FedEx: every FedEx call goes through its one token cache.
  imports: [WarehousesModule, CarriersModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService, OrderBookingService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
