import { Module } from '@nestjs/common';
import { FbaShipmentsController } from './fba-shipments.controller';
import { FbaShipmentsService } from './fba-shipments.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [JobsModule],
  controllers: [FbaShipmentsController],
  providers: [FbaShipmentsService],
  exports: [FbaShipmentsService],
})
export class FbaShipmentsModule {}
