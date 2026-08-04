import { Module } from '@nestjs/common';
import { FloorService } from './floor/floor.service';
import { VatService } from './floor/vat.service';
import { SnapshotService } from './ingest/snapshot.service';
import { SqsPollerService } from './ingest/sqs-poller.service';

// Amazon Buy Box algorithmic repricing (spec docs/specs/amazon-repricing/). Built as ONE Nest
// module rather than the spec's GCP microservice mesh (Deviation D-1).
//   • Phase 1: floor stack (pure solver + VAT adapter + floor-service).
//   • Phase 2: ingest (SnapshotService parse/dedupe/persist + SqsPollerService — poller dormant
//     until the AWS SQS bridge is configured).
//   • Decision-engine pure core (engine/) is wired by the repricer I/O shell (later).
// Later phases add: price-writer + safety layer, enrichment, and the ops console.
@Module({
  providers: [FloorService, VatService, SnapshotService, SqsPollerService],
  exports: [FloorService, VatService, SnapshotService],
})
export class AmazonRepricingModule {}
