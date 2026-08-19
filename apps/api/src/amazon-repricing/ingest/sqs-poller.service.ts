import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
  GetQueueAttributesCommand,
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
  // Since-boot counters. A message that fails to parse is logged and deleted, so without these
  // "arriving but unusable" is indistinguishable from "nothing arriving at all".
  private received = 0;
  private discarded = 0;
  private lastMessageAt: string | null = null;
  private lastReceiveError: string | null = null;

  constructor(private readonly snapshots: SnapshotService) {}

  /**
   * Health of the notification pipeline's front door, for the ops console. Reports whether each
   * AMZ_SQS_* var is PRESENT (never its value), whether the poller actually started, and — when it
   * did — what the queue itself says. Distinguishes "not configured" from "configured but AWS is
   * refusing us" from "connected but Amazon has sent nothing", which the logs otherwise hold.
   */
  async status(): Promise<Record<string, unknown>> {
    const env = {
      AMZ_SQS_QUEUE_URL: !!process.env.AMZ_SQS_QUEUE_URL,
      AMZ_SQS_REGION: !!process.env.AMZ_SQS_REGION,
      AMZ_SQS_ACCESS_KEY_ID: !!process.env.AMZ_SQS_ACCESS_KEY_ID,
      AMZ_SQS_SECRET_ACCESS_KEY: !!process.env.AMZ_SQS_SECRET_ACCESS_KEY,
    };
    const missing = Object.entries(env).filter(([, present]) => !present).map(([k]) => k);
    if (!this.running || !this.client) {
      return { poller: 'dormant', reason: missing.length ? `missing env: ${missing.join(', ')}` : 'not started', env };
    }
    try {
      const attrs = await this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
        }),
      );
      return {
        poller: 'running',
        env,
        // Separates "Amazon has sent nothing" from "messages arrive but we can't use them".
        messages: { receivedSinceBoot: this.received, discardedSinceBoot: this.discarded, lastMessageAt: this.lastMessageAt, lastReceiveError: this.lastReceiveError },
        queue: {
          reachable: true,
          // Normally 0 on a healthy pipeline: the poller drains messages as fast as they arrive.
          approximateMessages: Number(attrs.Attributes?.ApproximateNumberOfMessages ?? 0),
          inFlight: Number(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
        },
      };
    } catch (e) {
      // Running but AWS rejects us — almost always wrong keys/region or missing IAM permission.
      return {
        poller: 'running',
        env,
        messages: { receivedSinceBoot: this.received, discardedSinceBoot: this.discarded, lastMessageAt: this.lastMessageAt, lastReceiveError: this.lastReceiveError },
        queue: { reachable: false, error: (e as Error).message },
      };
    }
  }

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
    this.received += 1;
    this.lastMessageAt = new Date().toISOString();
    if (result.status === 'PARSE_ERROR') {
      this.discarded += 1;
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
        this.lastReceiveError = (e as Error).message;
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
