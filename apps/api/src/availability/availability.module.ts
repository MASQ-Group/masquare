import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService], // later phases (sell-through, channel sync) reuse adjust()
})
export class AvailabilityModule {}
