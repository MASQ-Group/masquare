import { Module } from '@nestjs/common';
import { CustomerShipmentsService } from './customer-shipments.service';
import { CustomerShipmentsController } from './customer-shipments.controller';

/** Shipments filed by the companies we ship for. Mail and notifications are global. */
@Module({
  controllers: [CustomerShipmentsController],
  providers: [CustomerShipmentsService],
  exports: [CustomerShipmentsService],
})
export class CustomerShipmentsModule {}
