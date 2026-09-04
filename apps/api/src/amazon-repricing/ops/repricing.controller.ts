import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { canApplyPreset } from '../config/resolve-preset';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../../common/current-user.decorator';
import { OnboardingService } from '../onboarding/onboarding.service';
import { FloorService } from '../floor/floor.service';
import { RepricingControlService } from '../writer/control.service';
import { BlocklistService, type BlockedSellerDto } from './blocklist.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ISO_TO_MARKETPLACE } from '../config/repricing.config';
import { IntegrationsService } from '../../integrations/integrations.service';
import { SqsPollerService } from '../ingest/sqs-poller.service';
import { queueForMarketplace } from '../config/notification-queues';
import { JobsService } from '../../jobs/jobs.service';
import { AccessArea } from '../../access/access.decorators';

// Ops console API for the Amazon repricing module (admin-only). Phase-appropriate subset: onboard
// SKUs, refresh fees + recompute floors, and inspect the SKU-pricing table + recent decisions.
// The full ops console (kill switches, quarantine queue, blocklist) is a later phase.
@ApiTags('amazon-repricing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('amazon-repricing')
@AccessArea('repricing')
export class RepricingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly floors: FloorService,
    private readonly control: RepricingControlService,
    private readonly blocklist: BlocklistService,
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly sqs: SqsPollerService,
    private readonly jobs: JobsService,
  ) {}

  /** Seller blocklist (§5.2): unauthorized / MAP-violating / hijacker sellers excluded from pricing. */
  @Get('blocklist')
  listBlocklist() {
    return this.blocklist.list();
  }

  @Post('blocklist')
  addBlocklist(@Body() dto: BlockedSellerDto, @CurrentUser() user: AuthUser) {
    return this.blocklist.add(dto, user.sub);
  }

  @Delete('blocklist/:id')
  removeBlocklist(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.blocklist.remove(id, user.sub);
  }

  /** Global runtime controls: the kill switch + live-writes master switch (§6.4). */
  @Get('control')
  getControl() {
    return this.control.get();
  }

  @Post('control')
  setControl(@Body() dto: { liveWritesEnabled?: boolean; killSwitchEngaged?: boolean }, @CurrentUser() user: AuthUser) {
    return this.control.update(dto, user.sub);
  }

  /** Seed/refresh RepricingSkuPricing from matched Amazon listings (§3.3). Pass `marketplace`
   *  (ISO-2, e.g. 'UK') to pilot one marketplace rather than onboarding the whole estate. */
  @Post('onboard')
  onboard(@Body() body: { marketplace?: string } = {}) {
    // Returns a job, not a result: onboarding the whole estate walks every matched listing, and
    // held open as one request it is indistinguishable from a hung page.
    const scope = body?.marketplace?.trim().toUpperCase() || 'all marketplaces';
    return this.jobs.start('repricing.onboard', `Onboarding SKUs — ${scope}`, (ctx) =>
      this.onboarding.syncSkuPricingFromListings({ marketplace: body?.marketplace, progress: ctx }),
    );
  }

  /** Data-readiness summary — counts by automation state / exclusion reason. */
  @Get('readiness')
  readiness() {
    return this.onboarding.readinessSummary();
  }

  /**
   * Pre-flight: does each Amazon connection actually hold the SP-API roles this module needs?
   * READ-ONLY (a fees estimate + a destinations list) — nothing is written, subscribed or priced,
   * so it is safe before activation. Answers "are Pricing/Notifications granted?" directly, rather
   * than finding out via a 403 deep inside the first sync.
   */
  @Get('diagnostics/roles')
  async roleDiagnostics() {
    const integrations = await this.prisma.channelIntegration.findMany({
      where: { channelType: 'amazon', deletedAt: null },
      select: { id: true, name: true, marketplace: true },
      orderBy: { name: 'asc' },
    });
    const results: Array<Record<string, unknown>> = [];
    for (const i of integrations) {
      const r = await this.integrations.checkSpApiRoles(i.id).catch((e) => ({
        ok: false,
        pricing: { ok: false, message: (e as Error).message },
        notifications: { ok: false, message: (e as Error).message },
      }));
      results.push({ integrationId: i.id, name: i.name, marketplace: i.marketplace, ...r });
    }
    return {
      total: results.length,
      pricingOk: results.filter((r) => (r.pricing as { ok: boolean }).ok).length,
      notificationsOk: results.filter((r) => (r.notifications as { ok: boolean }).ok).length,
      results,
    };
  }

  /**
   * Refresh fees + recompute the floor for every SKU (best-effort; makes ONE live SP-API call per
   * SKU). `marketplace` (ISO-2) scopes it, so a pilot doesn't fire thousands of calls at the whole
   * estate — the ids come from the connector-derived map, so any connected marketplace works.
   */
  @Post('floors/recompute')
  recomputeFloors(@Body() body: { marketplace?: string; limit?: number } = {}) {
    const iso = body?.marketplace?.trim().toUpperCase();
    const marketplaceId = iso ? ISO_TO_MARKETPLACE[iso] : undefined;
    if (iso && !marketplaceId) throw new BadRequestException(`Unknown marketplace '${iso}'`);
    // `limit` caps a run: SKUs whose floor was never computed come first, so a small trial run
    // exercises the fee pipeline on fresh rows rather than re-doing ones that already succeeded.
    const limit = Number(body?.limit) > 0 ? Math.floor(Number(body.limit)) : undefined;

    const label = `Recomputing floors — ${iso ?? 'all marketplaces'}${limit ? ` (first ${limit})` : ''}`;
    return this.jobs.start('repricing.recompute', label, async (ctx) => {
      const rows = await this.prisma.repricingSkuPricing.findMany({
        where: { deletedAt: null, ...(marketplaceId ? { marketplaceId } : {}) },
        select: { id: true, sku: true },
        orderBy: [{ floorsComputedAt: { sort: 'asc', nulls: 'first' } }],
        ...(limit ? { take: limit } : {}),
      });
      ctx.setTotal(rows.length);

      let ok = 0;
      let attempted = 0;
      for (const row of rows) {
        // Checked between SKUs rather than mid-call: a fee request already in flight is left to
        // finish, so stopping never leaves a half-written floor.
        if (ctx.cancelled) break;
        attempted += 1;
        ctx.note(row.sku);
        try {
          await this.floors.refreshFeesAndRecompute(row.id);
          ok += 1;
          ctx.tick(true);
        } catch {
          ctx.tick(false); /* logged in the service */
        }
      }
      return { processed: attempted, ok, stopped: ctx.cancelled && attempted < rows.length };
    });
  }

  /**
   * "Show your working" for one SKU's floor — every input and the figure it yields, recomputed
   * live but NOT saved. Use when a floor disagrees with Individual Pricing: it names the input
   * that differs (cost, shipping, FX, VAT, fees) instead of leaving it to be inferred.
   */
  @Get('diagnostics/floor')
  explainFloor(@Query('sku') sku?: string, @Query('marketplace') marketplace?: string) {
    return this.resolveSkuRow(sku, marketplace).then((row) =>
      row ? this.floors.explainFloor(row.id) : { error: `No SKU pricing row for '${sku}'${marketplace ? ` on ${marketplace}` : ''}` },
    );
  }

  private async resolveSkuRow(sku?: string, marketplace?: string) {
    if (!sku?.trim()) return null;
    const iso = marketplace?.trim().toUpperCase();
    const marketplaceId = iso ? ISO_TO_MARKETPLACE[iso] : undefined;
    return this.prisma.repricingSkuPricing.findFirst({
      where: { sku: sku.trim(), deletedAt: null, ...(marketplaceId ? { marketplaceId } : {}) },
      select: { id: true },
    });
  }

  /**
   * READ-ONLY: what Amazon has registered for a marketplace — destinations and live subscriptions.
   * The destination is created from an SQS ARN while the poller reads a queue URL; if those are
   * different queues everything looks configured yet nothing is ever delivered. This shows both so
   * they can be compared.
   */
  @Get('diagnostics/subscriptions')
  async subscriptionStatus(@Query('marketplace') marketplace?: string) {
    const iso = marketplace?.trim().toUpperCase();
    const integration = await this.prisma.channelIntegration.findFirst({
      where: { channelType: 'amazon', deletedAt: null, ...(iso ? { marketplace: iso } : {}) },
      select: { id: true, name: true, marketplace: true },
      orderBy: { name: 'asc' },
    });
    if (!integration) return { ok: false, message: `No Amazon integration${iso ? ` for ${iso}` : ''}` };
    const status = await this.integrations.spApiNotificationStatus(integration.id);
    const queue = queueForMarketplace(integration.marketplace);
    return {
      integration: integration.name,
      // The queue the POLLER reads, so it can be compared with the destination ARN above.
      pollerQueueUrl: process.env.AMZ_SQS_QUEUE_URL ?? null,
      expectedQueueArn: queue.queueArn,
      ...status,
    };
  }

  /**
   * The SQS queue a marketplace's notifications must go to, derived from its SP-API region.
   *
   * Exists so the subscribe form is never typed from memory: the ARN it offers is the one the
   * poller actually reads. Reads env only -- no Amazon call -- so it is safe to load on selection.
   */
  @Get('diagnostics/queue')
  queueForMarketplaceDiagnostic(@Query('marketplace') marketplace?: string) {
    return queueForMarketplace(marketplace);
  }

  /**
   * End-to-end health of the shadow pipeline: SQS -> snapshots -> decisions.
   *
   * "No decisions yet" has several very different causes — poller dormant, AWS refusing the
   * credentials, Amazon not publishing, or events arriving for ASINs we never onboarded. This
   * walks the chain in order and shows where it stops, instead of leaving the logs as the only
   * way to tell. Read-only.
   */
  @Get('diagnostics/pipeline')
  async pipelineStatus() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [poller, snapshots, snapshots24h, lastSnapshot, dedupe24h, decisions, decisions24h, lastDecision, skus, live] =
      await Promise.all([
        this.sqs.status(),
        this.prisma.repricingOfferSnapshot.count(),
        this.prisma.repricingOfferSnapshot.count({ where: { updatedAt: { gte: dayAgo } } }),
        this.prisma.repricingOfferSnapshot.findFirst({ orderBy: { updatedAt: 'desc' }, select: { asin: true, marketplaceId: true, updatedAt: true } }),
        this.prisma.repricingNotifDedupe.count({ where: { receivedAt: { gte: dayAgo } } }),
        this.prisma.repricingDecision.count(),
        this.prisma.repricingDecision.count({ where: { at: { gte: dayAgo } } }),
        this.prisma.repricingDecision.findFirst({ orderBy: { at: 'desc' }, select: { sku: true, outcome: true, at: true } }),
        this.prisma.repricingSkuPricing.count({ where: { deletedAt: null } }),
        this.prisma.repricingSkuPricing.count({ where: { deletedAt: null, automationState: 'SHADOW' } }),
      ]);

    // Read the chain in order — the first broken link is the one to fix.
    const received = (poller as { messages?: { receivedSinceBoot?: number; discardedSinceBoot?: number } }).messages;
    const notifications = dedupe24h > 0 || snapshots24h > 0 || (received?.receivedSinceBoot ?? 0) > 0;
    const diagnosis =
      (poller as { poller?: string }).poller !== 'running'
        ? 'Poller is not running — set the AMZ_SQS_* variables and redeploy.'
        : (poller as { queue?: { reachable?: boolean } }).queue?.reachable === false
          ? 'Poller is running but AWS rejected the request — check the keys, the region, and that the IAM user may ReceiveMessage on this queue.'
          : !notifications
            ? 'Connected to the queue, but no notifications have arrived in 24h. Confirm a marketplace is subscribed (Notification subscriptions card); Amazon only publishes when a listing you sell actually changes.'
            : (received?.receivedSinceBoot ?? 0) > 0 && (received?.discardedSinceBoot ?? 0) >= (received?.receivedSinceBoot ?? 0)
              ? 'Messages ARE arriving but every one failed to parse and was discarded — check the API logs for "Discarding unparseable SQS message".'
              : decisions === 0
                ? 'Notifications are arriving but no decisions were logged — events are probably for ASINs that have no onboarded SKU row on that marketplace.'
                : 'Pipeline healthy: notifications in, decisions logged.';

    return {
      diagnosis,
      sqs: poller,
      notifications: { dedupedLast24h: dedupe24h },
      snapshots: { total: snapshots, last24h: snapshots24h, mostRecent: lastSnapshot },
      decisions: { total: decisions, last24h: decisions24h, mostRecent: lastDecision },
      skus: { onboarded: skus, shadow: live },
    };
  }

  /**
   * SKU-pricing rows, paged and filterable. Onboarding seeds thousands, so an unfiltered slice is
   * not enough to audit a floor: you need to reach a specific SKU. Brand/vendor live on Product and
   * there is no Prisma relation from this table, so those resolve to product ids first.
   */
  @Get('sku-pricing')
  async skuPricing(
    @Query('take') take = '100',
    @Query('skip') skip = '0',
    @Query('q') q?: string,
    @Query('marketplace') marketplace?: string,
    @Query('brandId') brandId?: string,
    @Query('vendorId') vendorId?: string,
    @Query('state') state?: string,
  ) {
    const pageSize = Math.min(Math.max(Number(take) || 100, 1), 500);
    const offset = Math.max(Number(skip) || 0, 0);

    const iso = marketplace?.trim().toUpperCase();
    const marketplaceId = iso ? ISO_TO_MARKETPLACE[iso] : undefined;
    if (iso && !marketplaceId) return { items: [], total: 0, page: 1, pageSize };

    let productIds: string[] | undefined;
    if (brandId || vendorId) {
      const products = await this.prisma.product.findMany({
        where: { ...(brandId ? { brandId } : {}), ...(vendorId ? { vendorId } : {}) },
        select: { id: true },
      });
      productIds = products.map((p) => p.id);
      if (productIds.length === 0) return { items: [], total: 0, page: 1, pageSize };
    }

    const term = q?.trim();
    const where = {
      deletedAt: null,
      ...(marketplaceId ? { marketplaceId } : {}),
      ...(state ? { automationState: state } : {}),
      ...(productIds ? { productId: { in: productIds } } : {}),
      ...(term
        ? {
            OR: [
              { sku: { contains: term, mode: 'insensitive' as const } },
              { asin: { contains: term, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.repricingSkuPricing.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: pageSize,
        skip: offset,
        // Which strategy each SKU follows. Without it a bulk apply cannot be read back.
        include: { preset: { select: { id: true, name: true } } },
      }),
      this.prisma.repricingSkuPricing.count({ where }),
    ]);
    return { items, total, page: Math.floor(offset / pageSize) + 1, pageSize };
  }

  /**
   * Decision audit search (§6.6), paged.
   *
   * The audit is append-only and grows with every offer-change event, so an unpaged slice stops
   * being "recent decisions" and starts being "the only decisions you can reach". Returns a total
   * so the page count is real rather than inferred from a full-looking page.
   */
  @Get('decisions')
  async decisions(
    @Query('take') take = '100',
    @Query('skip') skip = '0',
    @Query('sku') sku?: string,
    @Query('outcome') outcome?: string,
  ) {
    const pageSize = Math.min(Math.max(Number(take) || 100, 1), 500);
    const offset = Math.max(Number(skip) || 0, 0);
    const where = {
      ...(sku?.trim() ? { sku: { contains: sku.trim(), mode: 'insensitive' as const } } : {}),
      ...(outcome ? { outcome } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.repricingDecision.findMany({ where, orderBy: { at: 'desc' }, take: pageSize, skip: offset }),
      this.prisma.repricingDecision.count({ where }),
    ]);
    return { items, total, page: Math.floor(offset / pageSize) + 1, pageSize };
  }

  /** Quarantine queue (§5.5, §7): SKUs taken off automation by an unresolvable conflict, oldest
   *  first. `total`/`oldestHours` drive the §7 escalation flag (> 20 open or > 24h old). */
  /** Which loaded costs each marketplace incurs. Absent = neither. */
  @Get('marketplace-costs')
  marketplaceCosts() {
    return this.prisma.repricingMarketplaceCosts.findMany({ orderBy: { marketplaceId: 'asc' } });
  }

  /**
   * Turn storage or advertising on for a marketplace.
   *
   * Enabling one makes it a REQUIRED input there: SKUs without a value are reported as omitting
   * it and refuse an aggressive strategy until it is set. That is the intent — the cost is real
   * on that marketplace — but it changes which SKUs a low-margin preset will accept.
   */
  @Post('marketplace-costs')
  async setMarketplaceCosts(
    @Body() body: { marketplace: string; storageApplies?: boolean; adsApply?: boolean; defaultStoragePerUnitCents?: number | null; defaultAdCostPerUnitCents?: number | null },
  ) {
    const iso = body?.marketplace?.trim().toUpperCase();
    const marketplaceId = iso ? ISO_TO_MARKETPLACE[iso] : undefined;
    if (!marketplaceId) return { error: `Unknown marketplace '${iso ?? ''}'` };
    const data = {
      storageApplies: body.storageApplies ?? false,
      adsApply: body.adsApply ?? false,
      defaultStoragePerUnitCents: body.defaultStoragePerUnitCents ?? null,
      defaultAdCostPerUnitCents: body.defaultAdCostPerUnitCents ?? null,
    };
    const saved = await this.prisma.repricingMarketplaceCosts.upsert({
      where: { marketplaceId },
      create: { marketplaceId, ...data },
      update: data,
    });
    // The floor is solved from these, so every stored floor on that marketplace is now stale.
    return { ...saved, recomputeNeeded: true };
  }

  /** The named strategies a SKU can follow. */
  @Get('strategies')
  strategies() {
    return this.prisma.repricingStrategyPreset.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Put SKUs on a strategy.
   *
   * Previews by default. An aggressive preset is REFUSED on a SKU whose floor omits storage or
   * advertising — at those margins the omission exceeds the margin, so the SKU would sell at a
   * loss the engine reports as a profit. Refused rather than warned about: a warning on a bulk
   * apply is read once, and the mispricing lasts until someone notices the margin.
   */
  @Post('strategies/assign')
  async assignStrategy(
    @Body()
    body: {
      presetId: string;
      apply?: boolean;
      // Any combination narrows the set; they compose rather than override one another, so
      // "Beurer on UK" is one selection rather than a choice between two.
      skuPricingIds?: string[];
      marketplace?: string;
      brandId?: string;
      vendorId?: string;
      productTypeId?: string;
      q?: string;
    },
  ) {
    const preset = await this.prisma.repricingStrategyPreset.findFirst({ where: { id: body?.presetId, deletedAt: null } });
    if (!preset) return { error: 'Strategy not found' };

    const iso = body?.marketplace?.trim().toUpperCase();
    const marketplaceId = iso ? ISO_TO_MARKETPLACE[iso] : undefined;
    if (iso && !marketplaceId) return { error: `Unknown marketplace '${iso}'` };

    // Brand, vendor and product type live on the product, not the pricing row.
    let productIds: string[] | undefined;
    if (body?.brandId || body?.vendorId || body?.productTypeId) {
      const products = await this.prisma.product.findMany({
        where: {
          ...(body.brandId ? { brandId: body.brandId } : {}),
          ...(body.vendorId ? { vendorId: body.vendorId } : {}),
          ...(body.productTypeId ? { productTypeId: body.productTypeId } : {}),
        },
        select: { id: true },
      });
      productIds = products.map((p) => p.id);
      // An empty match must select NOTHING, not fall through to every SKU — the difference
      // between a filter that found nobody and no filter at all is the whole catalogue.
      if (productIds.length === 0) return { preview: !body?.apply, strategy: preset.name, wouldApply: 0, refused: [] };
    }

    const term = body?.q?.trim();
    const rows = await this.prisma.repricingSkuPricing.findMany({
      where: {
        deletedAt: null,
        ...(body?.skuPricingIds?.length ? { id: { in: body.skuPricingIds } } : {}),
        ...(marketplaceId ? { marketplaceId } : {}),
        ...(productIds ? { productId: { in: productIds } } : {}),
        ...(term
          ? {
              OR: [
                { sku: { contains: term, mode: 'insensitive' as const } },
                { asin: { contains: term, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: { id: true, sku: true, marketplaceId: true, floorOmits: true, strategyFloorCents: true },
    });

    const eligible: string[] = [];
    const refused: Array<{ sku: string; marketplaceId: string; reason: string }> = [];
    for (const r of rows) {
      const v = canApplyPreset(preset, r);
      if (v.ok) eligible.push(r.id);
      else refused.push({ sku: r.sku, marketplaceId: r.marketplaceId, reason: v.reason });
    }

    if (!body?.apply) {
      return { preview: true, strategy: preset.name, wouldApply: eligible.length, refused };
    }

    await this.prisma.repricingSkuPricing.updateMany({ where: { id: { in: eligible } }, data: { presetId: preset.id } });
    // The floor depends on the margin, so a strategy change makes every stored floor on those SKUs
    // stale until it is recomputed. Saying so beats leaving the old number on screen looking current.
    return { applied: eligible.length, refused, recomputeNeeded: eligible.length > 0 };
  }

  /** What the repricer is holding, and what a purge would remove. */
  @Get('retention')
  retention() {
    return this.floors.retentionStats();
  }

  @Patch('retention')
  async setRetention(@Body() dto: { decisionDays?: number; feeDays?: number }) {
    // 0 means keep forever and is allowed; a negative window is meaningless, and anything past a
    // decade is a typo for something much smaller.
    for (const [k, v] of Object.entries(dto)) {
      if (v == null) continue;
      if (!Number.isInteger(v) || v < 0 || v > 3650) {
        throw new BadRequestException(`${k} must be a whole number of days between 0 and 3650 (0 = keep forever).`);
      }
    }
    // The decisions table is not only an audit log — the engine reads it back. The fair-pricing
    // ceiling takes a 30-day median of observed buy-box prices from it, and the anomaly guard a
    // 7-day one. Keeping less than 30 days does not fail: the medians quietly narrow, the ceiling
    // stops protecting against a competitor's bad feed, and the only symptom is a price nobody can
    // explain. Refused rather than warned about, because that is not a trade anyone would make
    // knowingly. 0 still means keep forever.
    if (dto.decisionDays != null && dto.decisionDays > 0 && dto.decisionDays < 31) {
      throw new BadRequestException(
        'Decisions must be kept at least 31 days: the fair-pricing ceiling reads a 30-day median of buy-box prices from them, and the anomaly guard a 7-day one.',
      );
    }
    const existing = await this.prisma.platformSettings.findFirst({ select: { id: true } });
    const data = {
      ...(dto.decisionDays != null ? { repricingDecisionRetentionDays: dto.decisionDays } : {}),
      ...(dto.feeDays != null ? { repricingFeeRetentionDays: dto.feeDays } : {}),
    };
    if (existing) await this.prisma.platformSettings.update({ where: { id: existing.id }, data });
    else await this.prisma.platformSettings.create({ data });
    return this.floors.retentionStats();
  }

  /**
   * Purge now rather than waiting for tonight. Separate from saving the window on purpose:
   * shortening retention and deleting to it are different decisions, and one button for both makes
   * a mistyped number irreversible before anyone sees the count.
   */
  @Post('retention/purge')
  async purgeRetention() {
    const removed = await this.floors.purgeRetention();
    return { ...removed, stats: await this.floors.retentionStats() };
  }

  @Get('quarantine')
  async quarantine(@Query('take') take = '50', @Query('skip') skip = '0') {
    const pageSize = Math.min(Math.max(Number(take) || 50, 1), 500);
    const offset = Math.max(Number(skip) || 0, 0);
    const where = { deletedAt: null, automationState: 'QUARANTINED' };

    // `total` counts the queue, not the page. It drives the escalation flag and the tab badge, so
    // a page-sized count would have read "20 open" forever once the queue passed one page.
    const [items, total, oldest] = await Promise.all([
      this.prisma.repricingSkuPricing.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        select: { id: true, sku: true, asin: true, marketplaceId: true, currency: true, strategy: true, strategyFloorCents: true, maxPriceCents: true, fairPricingCeilingCents: true, updatedAt: true },
        take: pageSize,
        skip: offset,
      }),
      this.prisma.repricingSkuPricing.count({ where }),
      this.prisma.repricingSkuPricing.findFirst({ where, orderBy: { updatedAt: 'asc' }, select: { updatedAt: true } }),
    ]);
    const oldestHours = oldest ? Math.floor((Date.now() - oldest.updatedAt.getTime()) / 3_600_000) : 0;

    // The conflict that quarantined each SKU. Without it the queue lists SKUs and asks the user to
    // "fix the values" without saying which value is wrong — and the binding ceiling is often
    // Amazon's own max allowed price, which is not one of the columns shown.
    const reasons = new Map<string, string>();
    if (items.length) {
      const rows = await this.prisma.repricingDecision.findMany({
        where: { outcome: 'QUARANTINED', OR: items.map((i) => ({ sku: i.sku, marketplaceId: i.marketplaceId })) },
        orderBy: { at: 'desc' },
        select: { sku: true, marketplaceId: true, reason: true },
        take: 1000,
      });
      // Ordered newest first, so the first hit for a SKU is its most recent quarantine.
      for (const r of rows) {
        const key = `${r.sku}:${r.marketplaceId}`;
        if (r.reason && !reasons.has(key)) reasons.set(key, r.reason);
      }
    }

    return {
      total,
      oldestHours,
      page: Math.floor(offset / pageSize) + 1,
      pageSize,
      items: items.map((i) => ({ ...i, reason: reasons.get(`${i.sku}:${i.marketplaceId}`) ?? null })),
    };
  }

  /** Resolve a quarantined SKU: after the human fixes the conflicting values, return it to shadow
   *  so the next event re-evaluates it. */
  @Post('quarantine/:id/resolve')
  async resolveQuarantine(@Param('id') id: string) {
    await this.prisma.repricingSkuPricing.updateMany({
      where: { id, automationState: 'QUARANTINED' },
      data: { automationState: 'SHADOW' },
    });
    return { resolved: true };
  }
}
