import { Module } from '@nestjs/common';
import { FbaShipmentsController } from './fba-shipments.controller';
import { FbaShipmentsService } from './fba-shipments.service';

@Module({
  controllers: [FbaShipmentsController],
  providers: [FbaShipmentsService],
  exports: [FbaShipmentsService],
})
export class FbaShipmentsModule {}
