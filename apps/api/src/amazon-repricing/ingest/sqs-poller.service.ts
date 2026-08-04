import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SnapshotService } from './snapshot.service';

// notif-ingest SQS poller (spec §2.2, findings D-1). SP-API Notifications deliver ONLY to AWS SQS,
// so this is the one unavoidable AWS piece: long-poll the queue, hand each message body to the
// SnapshotService (parse → dedupe → stale-discard → persist), delete on success.
//
// NOT WIRED YET — the actual receive/delete against AWS is stubbed. It needs (Phase 0/2, external):
//   • an SQS queue in an AWS account we control, resource-policy'd for SP-API's principal
//   • createDestination + createSubscription for ANY_OFFER_CHANGED / PRICING_HEALTH / FEE_PROMOTION
//   • AWS creds in the secrets store + the @aws-sdk/client-sqs dependency
// Until AMZ_SQS_QUEUE_URL is configured this service stays dormant. The processing seam
// (handleMessage) is real and unit-testable via SnapshotService.ingestRaw — only the transport is stubbed.

interface SqsMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
}

@Injectable()
export class SqsPollerService implements OnModuleInit {
  private readonly logger = new Logger(SqsPollerService.name);
  private readonly queueUrl = process.env.AMZ_SQS_QUEUE_URL ?? '';
  private running = false;

  constructor(private readonly snapshots: SnapshotService) {}

  onModuleInit(): void {
    if (!this.queueUrl) {
      this.logger.warn('AMZ_SQS_QUEUE_URL not set — SP-API notification poller is dormant (Phase 2 pending).');
      return;
    }
    this.running = true;
    void this.pollLoop();
  }

  /** Process one message body end-to-end. Real and testable; the transport around it is stubbed. */
  async handleMessage(msg: SqsMessage): Promise<boolean> {
    const result = await this.snapshots.ingestRaw(msg.body);
    if (result.status === 'PARSE_ERROR') {
      // Malformed messages must not wedge the queue — log and let it be deleted (or DLQ'd).
      this.logger.error(`Discarding unparseable SQS message ${msg.messageId}: ${result.detail}`);
    }
    return true; // delete from the queue in all non-throwing cases; retries only on thrown errors
  }

  private async pollLoop(): Promise<void> {
    this.logger.log('SP-API notification poller started.');
    while (this.running) {
      let messages: SqsMessage[] = [];
      try {
        messages = await this.receiveMessages();
      } catch (e) {
        this.logger.error(`SQS receive failed: ${(e as Error).message}`);
        await this.sleep(5000);
        continue;
      }
      for (const msg of messages) {
        try {
          const ok = await this.handleMessage(msg);
          if (ok) await this.deleteMessage(msg.receiptHandle);
        } catch (e) {
          // Leave the message on the queue; SQS visibility timeout will redeliver.
          this.logger.error(`Handling SQS message ${msg.messageId} failed, will retry: ${(e as Error).message}`);
        }
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  // --- AWS transport (STUBBED — wire @aws-sdk/client-sqs here once the bridge exists) ---

  private async receiveMessages(): Promise<SqsMessage[]> {
    // TODO(Phase 2): ReceiveMessageCommand with WaitTimeSeconds=20 (long poll), MaxNumberOfMessages=10.
    throw new Error('SQS receive not wired — AWS bridge pending (spec §2.2 / Phase 0 §3.2).');
  }

  private async deleteMessage(_receiptHandle: string): Promise<void> {
    // TODO(Phase 2): DeleteMessageCommand.
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
