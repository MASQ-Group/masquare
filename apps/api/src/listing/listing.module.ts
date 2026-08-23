import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';

@Module({
  controllers: [ListingController],
  providers: [ListingService],
  exports: [ListingService],
})
export class ListingModule {}
