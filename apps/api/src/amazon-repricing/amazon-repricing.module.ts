import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FloorService } from './floor/floor.service';
import { VatService } from './floor/vat.service';
import { FeeService } from './floor/fee.service';
import { SnapshotService } from './ingest/snapshot.service';
import { SqsPollerService } from './ingest/sqs-poller.service';
import { RepricerService } from './engine/repricer.service';
import { PriceWriterService } from './writer/price-writer.service';
import { RepricingControlService } from './writer/control.service';
import { OnboardingService } from './onboarding/onboarding.service';
import { RepricingController } from './ops/repricing.controller';

// Amazon Buy Box algorithmic repricing (spec docs/specs/amazon-repricing/). Built as ONE Nest
// module rather than the spec's GCP microservice mesh (Deviation D-1).
//   • Phase 1: floor stack (pure solver + VAT adapter + floor-service).
//   • Phase 2: ingest (SnapshotService parse/dedupe/persist + SqsPollerService — poller dormant
//     until the AWS SQS bridge is configured).
//   • Decision-engine: pure core (engine/) + RepricerService I/O shell (evaluate → decide →
//     audit; SHADOW mode logs the intended price, submits nothing).
// Later phases add: price-writer + safety-layer wiring, enrichment, and the ops console.
@Module({
  imports: [IntegrationsModule],
  controllers: [RepricingController],
  providers: [FloorService, VatService, FeeService, SnapshotService, SqsPollerService, RepricerService, PriceWriterService, RepricingControlService, OnboardingService],
  exports: [FloorService, VatService, SnapshotService, RepricerService, PriceWriterService, OnboardingService],
})
export class AmazonRepricingModule {}
