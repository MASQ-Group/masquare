import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { MarketSnapshot } from '../engine/types';
import { RepricerService } from '../engine/repricer.service';
import { REPRICING_DEFAULTS } from '../config/repricing.config';
import { CoalesceQueue } from './coalesce-queue';

// §5.1 step 0 decoupling — the NestJS wrapper around the pure CoalesceQueue. A fresh snapshot is
// scheduled into its ASIN × marketplace window; when the window closes (default 30s) the LATEST
// snapshot is evaluated once (shadow), coalescing the ANY_OFFER_CHANGED burst a single price move
// produces. Real timers here; all the keep-latest/ordering logic (and its tests) live in the queue.

interface Pending {
  snapshot: MarketSnapshot;
  notificationId: string | null;
}

@Injectable()
export class RepriceSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(RepriceSchedulerService.name);
  private readonly queue: CoalesceQueue<Pending>;

  constructor(private readonly repricer: RepricerService) {
    this.queue = new CoalesceQueue<Pending>(
      {
        windowMs: REPRICING_DEFAULTS.debounceWindowSeconds * 1000,
        setTimer: (cb, ms) => setTimeout(cb, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      (key, item) => void this.run(key, item),
    );
  }

  /** Coalesce a fresh snapshot into its per-ASIN window (ordered by TimeOfOfferChange). */
  schedule(snapshot: MarketSnapshot, notificationId: string | null): void {
    const key = `${snapshot.asin}:${snapshot.marketplaceId}`;
    const parsed = snapshot.timeOfOfferChange ? Date.parse(snapshot.timeOfOfferChange) : NaN;
    const orderMs = Number.isNaN(parsed) ? Date.now() : parsed;
    this.queue.submit(key, { snapshot, notificationId }, orderMs);
  }

  /** Open (not-yet-evaluated) windows — for tests / diagnostics. */
  get pendingWindows(): number {
    return this.queue.size;
  }

  private async run(key: string, item: Pending): Promise<void> {
    try {
      await this.repricer.evaluate(item.snapshot, {
        triggerType: 'ANY_OFFER_CHANGED',
        notificationId: item.notificationId,
        safetyOverride: false,
      });
    } catch (e) {
      this.logger.error(`Coalesced evaluation failed for ${key}: ${(e as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.queue.clear();
  }
}
