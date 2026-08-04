import { Module } from '@nestjs/common';
import { FloorService } from './floor/floor.service';
import { VatService } from './floor/vat.service';

// Amazon Buy Box algorithmic repricing (spec docs/specs/amazon-repricing/). Built as ONE Nest
// module rather than the spec's GCP microservice mesh (Deviation D-1). Phase 1 delivers the floor
// stack (pure solver + VAT adapter + floor-service). Later phases add: ingest (SQS poller),
// engine (decision core), writer (price-writer + safety layer), enrichment, and the ops console.
@Module({
  providers: [FloorService, VatService],
  exports: [FloorService, VatService],
})
export class AmazonRepricingModule {}
