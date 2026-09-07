import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AmazonListingService } from '../amazon/amazon-listing.service';
import { fullScopeIntegrationWhere } from '../../common/amazon-scope';
import { coverage, nextBatch, pairKey, type SweepPair, type SweepSettings } from './sweep-queue';
import { recordAvailability } from './availability-record';

/** Between pairs. Two SP-API calls each, so this holds the sweep near one call a second. */
const PACE_MS = 1_500;

/**
 * Keeping "where could we list this" answered, quietly and continuously.
 *
 * The question costs two SP-API calls per product per marketplace, and once the marketplaces we
 * already sell on are excluded it is some 6,500 pairs — too many to answer on demand, and too many
 * to answer nightly: a nightly pass is thousands of calls inside one window, which is the shape
 * that gets a seller account throttled. It runs instead as a small batch on an interval — the same calls
 * spread thinly, stoppable at any point without losing what it has already learnt.
 *
 * The answers change on the order of months. Catalogue presence moves when Amazon adds or merges an
 * ASIN; brand gating moves when an approval is granted. Neither happens between one morning and the
 * next, which is why a 30-day re-check is generous rather than stingy.
 */
@Injectable()
export class AvailabilitySweepService {
  private readonly logger = new Logger(AvailabilitySweepService.name);

  /**
   * One batch at a time within this process.
   *
   * A batch can outlive its own interval — 60 pairs at ~1.5s each is 90 seconds, and a slow
   * marketplace stretches that. Without this, a long batch and the next tick would run together and
   * ask about the same pairs twice, since neither has written its results yet.
   */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly amazon: AmazonListingService,
  ) {}

  /**
   * Ticks often; works rarely.
   *
   * The cadence a person configures lives in the settings, not in this expression, so changing it
   * takes effect on the next tick rather than on the next deploy. Five minutes is simply the
   * smallest interval anyone could usefully ask for.
   */
  @Cron('*/5 * * * *')
  async tick(): Promise<void> {
    try {
      await this.runDueBatch();
    } catch (e) {
      // A sweep failing must never take the API process with it. It is a background refresh of
      // stored answers; nothing on any screen is waiting for it.
      this.logger.error(`Availability sweep failed: ${(e as Error)?.message ?? e}`);
    }
  }

  /** The settings row, falling back to the defaults if nobody has saved one yet. */
  async settings(): Promise<SweepSettings & { enabled: boolean; lastRunAt: Date | null }> {
    const s = await this.prisma.platformSettings.findFirst({
      select: {
        availabilitySweepEnabled: true,
        availabilitySweepBatchSize: true,
        availabilitySweepIntervalMinutes: true,
        availabilityRecheckDays: true,
        availabilitySweepLastRunAt: true,
      },
    });
    return {
      enabled: s?.availabilitySweepEnabled ?? false,
      batchSize: s?.availabilitySweepBatchSize ?? 60,
      intervalMinutes: s?.availabilitySweepIntervalMinutes ?? 120,
      recheckDays: s?.availabilityRecheckDays ?? 30,
      lastRunAt: s?.availabilitySweepLastRunAt ?? null,
    };
  }

  /** Run a batch if one is due. Reports what it did, so a manual "run now" can say so. */
  async runDueBatch(force = false): Promise<{ ran: boolean; reason?: string; checked?: number; failed?: number }> {
    const cfg = await this.settings();
    if (!cfg.enabled && !force) return { ran: false, reason: 'The scheduled check is switched off' };
    if (this.running) return { ran: false, reason: 'A batch is already running' };

    if (!force && cfg.lastRunAt) {
      const dueAt = cfg.lastRunAt.getTime() + cfg.intervalMinutes * 60_000;
      if (Date.now() < dueAt) return { ran: false, reason: 'Not due yet' };
    }

    this.running = true;
    try {
      // Claimed before the work, not after. The interval is measured from the START of a batch, so
      // a batch that runs long does not push the next one out by its own duration, and a restart
      // mid-batch cannot make the next tick repeat it immediately.
      await this.claim();
      return { ran: true, ...(await this.runBatch(cfg)) };
    } finally {
      this.running = false;
    }
  }

  private async claim(): Promise<void> {
    const row = await this.prisma.platformSettings.findFirst({ select: { id: true } });
    if (row) {
      await this.prisma.platformSettings.update({
        where: { id: row.id },
        data: { availabilitySweepLastRunAt: new Date() },
      });
    }
  }

  /**
   * Every pair worth asking about, and the ones a listing already answers.
   *
   * Products with no EAN or UPC are left out entirely. Amazon can only be searched on a unique
   * identifier — a title match is how an offer lands on a different product — so for those the
   * answer is not "unknown, pending a check" but "unanswerable until somebody fills in the
   * identifier". Including them would spend a slot in every batch forever to re-learn that.
   */
  async candidatePairs(): Promise<{ pairs: SweepPair[]; listed: Set<string>; totalPairs: number }> {
    const integrations = await this.prisma.channelIntegration.findMany({
      where: {
        deletedAt: null,
        channelType: 'amazon',
        // The same scope the manual sweep uses: assigned accounts we are allowed to list on. An
        // orders-only company's account must not be probed for listing opportunities.
        ...(await fullScopeIntegrationWhere(this.prisma)),
      },
      select: { id: true, targetCompanyId: true, marketplace: true },
    });

    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        // An empty string is not an identifier. `not: null` alone lets '' through, and those
        // products would enter the queue only to have Amazon refuse to be searched — storing a
        // "not found" that reads like a verdict about the product rather than about our record.
        OR: [
          { AND: [{ ean: { not: null } }, { ean: { not: '' } }] },
          { AND: [{ upc: { not: null } }, { upc: { not: '' } }] },
        ],
      },
      select: { id: true },
    });

    const stored = await this.prisma.productChannelAvailability.findMany({
      select: { productId: true, integrationId: true, checkedAt: true },
    });
    const checkedAt = new Map(stored.map((r) => [pairKey(r), r.checkedAt]));

    const live = await this.prisma.channelListing.findMany({
      where: { productId: { not: null }, integrationId: { in: integrations.map((i) => i.id) } },
      select: { productId: true, integrationId: true },
    });
    const listed = new Set(
      live.filter((l) => l.productId).map((l) => pairKey({ productId: l.productId!, integrationId: l.integrationId })),
    );

    const pairs: SweepPair[] = [];
    for (const product of products) {
      for (const integration of integrations) {
        pairs.push({
          productId: product.id,
          integrationId: integration.id,
          checkedAt: checkedAt.get(`${product.id}:${integration.id}`) ?? null,
        });
      }
    }
    return { pairs, listed, totalPairs: pairs.filter((p) => !listed.has(pairKey(p))).length };
  }

  private async runBatch(cfg: SweepSettings): Promise<{ checked: number; failed: number }> {
    const { pairs, listed } = await this.candidatePairs();
    const batch = nextBatch(pairs, listed, cfg, new Date());
    if (batch.length === 0) {
      this.logger.log('Availability sweep: nothing due.');
      return { checked: 0, failed: 0 };
    }

    const byId = new Map(
      (
        await this.prisma.channelIntegration.findMany({
          where: { id: { in: [...new Set(batch.map((p) => p.integrationId))] } },
          select: { id: true, targetCompanyId: true, marketplace: true },
        })
      ).map((i) => [i.id, i]),
    );

    let checked = 0;
    let failed = 0;
    for (const [index, p] of batch.entries()) {
      const integration = byId.get(p.integrationId);
      if (!integration?.targetCompanyId) continue;
      const marketplace = integration.marketplace ?? '';
      try {
        await this.checkPair(p.productId, integration.id, integration.targetCompanyId, marketplace, 'scheduled');
        checked += 1;
      } catch (e) {
        // One pair failing must not lose the other fifty-nine. The failure is written to the row
        // itself, so a marketplace that fails every time shows as a column of errors rather than as
        // an absence nobody can distinguish from "not reached yet".
        failed += 1;
        await this.record(
          p.productId,
          integration.id,
          integration.targetCompanyId,
          marketplace,
          {
            found: false, asin: null, productType: null, title: null, imageUrl: null,
            restricted: null, restrictionReason: null,
            error: (e as Error)?.message ?? 'Check failed',
          },
          'scheduled',
        ).catch(() => undefined);
      }
      // Paced BETWEEN pairs, so the batch does not end on a wait against nothing.
      if (index < batch.length - 1) await new Promise((r) => setTimeout(r, PACE_MS));
    }

    this.logger.log(`Availability sweep: checked ${checked}, ${failed} failed, out of a batch of ${batch.length}.`);
    return { checked, failed };
  }

  /**
   * Ask Amazon about one pair and store the answer.
   *
   * Public because the manual "Check Amazon Availability" writes through the same path. Two routes
   * to the same fact would eventually give two different answers, and the one on screen would be
   * whichever happened to run last.
   */
  async checkPair(
    productId: string,
    integrationId: string,
    companyId: string,
    marketplace: string,
    source: 'scheduled' | 'manual',
  ): Promise<void> {
    const found = await this.amazon.findCandidates(productId, integrationId);
    const top = found.candidates[0] ?? null;
    await this.record(
      productId,
      integrationId,
      companyId,
      marketplace,
      {
        found: !!top,
        asin: top?.asin ?? null,
        productType: top?.productType ?? null,
        title: top?.title ?? null,
        imageUrl: top?.imageUrl ?? null,
        restricted: top?.restricted ?? null,
        restrictionReason: top?.restrictionReasons?.[0]?.message ?? null,
        error: top ? null : (found.message ?? 'No catalogue entry for this identifier'),
      },
      source,
    );
  }

  private record(
    productId: string,
    integrationId: string,
    companyId: string,
    marketplace: string,
    result: Parameters<typeof recordAvailability>[2],
    source: 'scheduled' | 'manual',
  ): Promise<void> {
    return recordAvailability(this.prisma, { productId, integrationId, companyId, marketplace }, result, source);
  }

  /** What the schedule is achieving, in the terms someone setting it would ask about. */
  async status() {
    const cfg = await this.settings();
    const { pairs, listed, totalPairs } = await this.candidatePairs();
    const outstanding = pairs.filter((p) => !listed.has(pairKey(p)));
    const answered = outstanding.filter((p) => p.checkedAt != null);
    const c = coverage(totalPairs, cfg);

    return {
      enabled: cfg.enabled,
      batchSize: cfg.batchSize,
      intervalMinutes: cfg.intervalMinutes,
      recheckDays: cfg.recheckDays,
      lastRunAt: cfg.lastRunAt,
      nextDueAt: cfg.lastRunAt ? new Date(cfg.lastRunAt.getTime() + cfg.intervalMinutes * 60_000) : null,
      /** Pairs the sweep is responsible for. Already-listed ones are not among them. */
      totalPairs,
      checkedPairs: answered.length,
      neverChecked: outstanding.length - answered.length,
      oldestCheckedAt: answered.map((p) => p.checkedAt!).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
      pairsPerDay: c.pairsPerDay,
      // Infinity does not survive JSON, and null reads as "never" far better than the 0 or the
      // dropped key it would otherwise become.
      fullPassDays: Number.isFinite(c.fullPassDays) ? c.fullPassDays : null,
      behind: c.behind,
    };
  }
}
