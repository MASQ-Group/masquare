import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { SnapshotService } from './snapshot.service';

// notif-ingest SQS poller (spec §2.2, findings D-1). SP-API Notifications deliver ONLY to AWS SQS,
// so this is the one unavoidable AWS piece: long-poll the queue, hand each message body to the
// SnapshotService (parse → dedupe → stale-discard → persist), delete on success.
//
// Config (env): AMZ_SQS_QUEUE_URL, AMZ_SQS_REGION, AMZ_SQS_ACCESS_KEY_ID, AMZ_SQS_SECRET_ACCESS_KEY.
// Dormant until those are set (so dev/test never polls). Still requires the queue's subscriptions
// to be registered (createDestination/createSubscription — IntegrationsService.setupSpApiNotifications).

interface SqsMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
}

@Injectable()
export class SqsPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsPollerService.name);
  private readonly queueUrl = process.env.AMZ_SQS_QUEUE_URL ?? '';
  private client: SQSClient | null = null;
  private running = false;

  constructor(private readonly snapshots: SnapshotService) {}

  onModuleInit(): void {
    const region = process.env.AMZ_SQS_REGION;
    const accessKeyId = process.env.AMZ_SQS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AMZ_SQS_SECRET_ACCESS_KEY;
    if (!this.queueUrl || !region || !accessKeyId || !secretAccessKey) {
      this.logger.warn('AMZ_SQS_* env not fully set — SP-API notification poller is dormant.');
      return;
    }
    this.client = new SQSClient({ region, credentials: { accessKeyId, secretAccessKey } });
    this.running = true;
    void this.pollLoop();
  }

  onModuleDestroy(): void {
    this.stop();
    this.client?.destroy();
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

  // --- AWS transport ---

  private async receiveMessages(): Promise<SqsMessage[]> {
    if (!this.client) return [];
    const out = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20, // long poll — cheap, low-latency
      }),
    );
    return (out.Messages ?? [])
      .filter((m: Message): m is Message & { ReceiptHandle: string; Body: string } => !!m.ReceiptHandle && m.Body != null)
      .map((m) => ({ messageId: m.MessageId ?? '', receiptHandle: m.ReceiptHandle, body: m.Body }));
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    if (!this.client) return;
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
