import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { VatService } from './vat.service';
import { FeeService } from './fee.service';
import { FloorInputs, solveFloors } from './floor-solver';
import { eurToCents } from '../common/money';
import { PricingFxService } from '../../pricing/fx.service';
import { PricingService } from '../../pricing/pricing.service';
import { MARKETPLACE_TO_ISO, REPRICING_DEFAULTS, toCountryIso } from '../config/repricing.config';
import { assertValidSchedule, referralScheduleFor } from '../config/referral-schedule';

// floor-service (spec §4.3): recompute breakeven + strategy floors per SKU × marketplace, mark
// stale floors, exclude SKUs whose inputs are missing/unknown. It is the ONLY writer of the
// floor + exclusion fields on RepricingSkuPricing. The math itself lives in the pure solver;
// this class only ASSEMBLES inputs (VAT, COGS, fees) and PERSISTS results — never guesses a floor.

/** Why a SKU can't be automated — written to RepricingSkuPricing.exclusionReason. */
type ExclusionReason =
  | 'COGS_MISSING'
  | 'VAT_UNKNOWN'
  | 'FX_UNKNOWN'
  | 'SHIP_UNKNOWN'
  | 'FEES_UNKNOWN'
  | 'FLOOR_INFEASIBLE'
  | 'FLOOR_STALE';

@Injectable()
export class FloorService {
  private readonly logger = new Logger(FloorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vat: VatService,
    private readonly fees: FeeService,
    private readonly fx: PricingFxService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Read-only "show your working" for one SKU's floor: every input, where it came from, and the
   * figure they produce — WITHOUT persisting anything. When a floor disagrees with Individual
   * Pricing this says which input differs, instead of leaving us to infer it from the output.
   * Mirrors computeFloorsForSku's input gathering; keep the two in step.
   */
  async explainFloor(skuPricingId: string) {
    const row = await this.prisma.repricingSkuPricing.findUnique({ where: { id: skuPricingId } });
    if (!row) return { error: 'SKU pricing row not found' };

    const tax = await this.channelTax(row.marketplaceId, row.currentPriceCents);
    const vatRate = tax != null ? tax.vatPct / 100 : null;
    const destCountryId = await this.destinationCountryId(row.marketplaceId);
    const unit = row.productId
      ? await this.pricing.unitCostInputsEur(row.productId, destCountryId)
      : { costEur: null, shippingEur: null, serviceName: null, weightKg: null };
    const ccy = (row.currency ?? 'EUR').toUpperCase();
    const eurPerUnit = ccy === 'EUR' ? 1 : await this.fx.toEur(ccy);
    const fee = await this.prisma.repricingFeeEstimate.findFirst({
      where: { sku: row.sku, marketplaceId: row.marketplaceId },
      orderBy: { fetchedAt: 'desc' },
    });
    const isFba = row.fulfillment === 'FBA' || row.fulfillment === 'SFP';

    const cogsLandedCents = unit.costEur != null && eurPerUnit ? eurToCents(unit.costEur / eurPerUnit) : null;
    const fixedPerUnitCents = !isFba && unit.shippingEur != null && eurPerUnit ? eurToCents(unit.shippingEur / eurPerUnit) : 0;

    let recomputed: { breakevenCents: number | null; strategyFloorCents: number | null } | null = null;
    if (vatRate != null && cogsLandedCents != null) {
      recomputed = solveFloors(
        {
          vatRate,
          referralBrackets: referralScheduleFor(null),
          fbaFulfillmentFeeCents: isFba ? fee?.fbaFulfillmentFeeCents ?? 0 : 0,
          closingFeeCents: fee?.closingFeeCents ?? 0,
          cogsLandedCents,
          fixedPerUnitCents,
          searchHiCents: row.amazonMaxAllowedCents ?? undefined,
        },
        row.minMarginPct != null ? Number(row.minMarginPct) / 100 : REPRICING_DEFAULTS.minMarginPct,
      );
    }

    return {
      sku: row.sku,
      marketplaceId: row.marketplaceId,
      currency: ccy,
      fulfillment: row.fulfillment,
      automationState: row.automationState,
      exclusionReason: row.exclusionReason,
      inputs: {
        vatRate,
        taxType: tax?.taxType ?? null,
        vatSource: tax != null ? 'sales channel (threshold-aware)' : 'unresolved',
        destCountryId,
        costEur: unit.costEur,
        shippingEur: unit.shippingEur,
        shippingService: unit.serviceName,
        chargeableWeightKg: unit.weightKg,
        fxNativeToEur: eurPerUnit,
        cogsLandedCents,
        fixedPerUnitCents,
        fbaFulfillmentFeeCents: isFba ? fee?.fbaFulfillmentFeeCents ?? 0 : 0,
        closingFeeCents: fee?.closingFeeCents ?? 0,
        minMarginPct: row.minMarginPct != null ? Number(row.minMarginPct) : REPRICING_DEFAULTS.minMarginPct * 100,
      },
      stored: {
        breakevenCents: row.breakevenCents,
        strategyFloorCents: row.strategyFloorCents,
        floorsComputedAt: row.floorsComputedAt,
      },
      recomputedNow: recomputed,
    };
  }

  /** Destination tax for a marketplace, via the Amazon integration's target sales channel — the
   *  channel carries the threshold rules the country row does not. Null when unresolvable, which
   *  excludes the SKU rather than defaulting to 0% (a 0% VAT floor is far too low). */
  private async channelTax(marketplaceId: string, currentPriceCents: number | null) {
    const iso = MARKETPLACE_TO_ISO[marketplaceId]; // Amazon's code — integrations store 'UK', not 'GB'
    if (!iso) return null;
    const integration = await this.prisma.channelIntegration.findFirst({
      where: { channelType: 'amazon', marketplace: iso, deletedAt: null, targetSalesChannelId: { not: null } },
      select: { targetSalesChannelId: true },
    });
    if (!integration?.targetSalesChannelId) return null;
    // Threshold rules key off the price, so use what the SKU currently sells at (nominal if unset).
    const gross = (currentPriceCents ?? 2000) / 100;
    return this.pricing.channelTaxFor(integration.targetSalesChannelId, gross);
  }

  /** The destination Country row id for a marketplace, via its ISO code ('UK' normalises to 'GB').
   *  Null when unmapped — shipping then can't resolve and an FBM SKU is excluded rather than
   *  given a floor that ignores carriage. */
  private async destinationCountryId(marketplaceId: string): Promise<string | null> {
    const iso = toCountryIso(MARKETPLACE_TO_ISO[marketplaceId]);
    if (!iso) return null;
    const c = await this.prisma.country.findUnique({ where: { isoCode: iso }, select: { id: true } });
    return c?.id ?? null;
  }

  /**
   * Recompute both floors for one SKU × marketplace row and persist them. On any missing/unknown
   * input the SKU is EXCLUDED with a reason (spec §4.3 — the engine never guesses a floor). On
   * success the floors + a staleAfter horizon + an inputsHash are stored; an EXCLUDED SKU whose
   * inputs are now healthy is promoted to SHADOW (submits nothing until a human/rollout goes LIVE).
   */
  async computeFloorsForSku(skuPricingId: string): Promise<void> {
    const row = await this.prisma.repricingSkuPricing.findUnique({ where: { id: skuPricingId } });
    if (!row) throw new Error(`RepricingSkuPricing ${skuPricingId} not found`);

    // KILLED / MANUAL_ONLY / QUARANTINED are human-controlled — compute floors for reference but
    // never change their automationState here.
    const humanControlled = ['KILLED', 'QUARANTINED'].includes(row.automationState) || row.strategy === 'MANUAL_ONLY';

    // --- Destination tax, resolved the SAME way as the rest of the platform ---------------
    // NOT simply Country.vatRate: JP/AU have their own regimes and threshold marketplaces (UK's
    // £135) switch rate either side of it. The country row for GB carries 0%, because the real
    // rule lives on the sales channel — reading the country rate alone silently produced a 0% VAT
    // floor, roughly halving every UK breakeven. Resolve at the SKU's current price, which is the
    // side of the threshold it actually trades on.
    const tax = await this.channelTax(row.marketplaceId, row.currentPriceCents);
    if (tax == null) return this.exclude(row.id, 'VAT_UNKNOWN', humanControlled);
    const vatRate = tax.vatPct / 100;

    // --- Landed COGS from the matched product (moving-average, else purchase cost) ---
    if (!row.productId) return this.exclude(row.id, 'COGS_MISSING', humanControlled);
    // Cost + outbound shipping come from PricingService so the floor is built on exactly the same
    // basis as Individual Pricing, the listing grid and a booked sale (it also honours
    // purchaseCostCurrency, which reading purchaseCostAmount raw would not).
    const destCountryId = await this.destinationCountryId(row.marketplaceId);
    const unit = await this.pricing.unitCostInputsEur(row.productId, destCountryId);
    const cogsEur = unit.costEur;
    if (cogsEur == null || Number(cogsEur) <= 0) return this.exclude(row.id, 'COGS_MISSING', humanControlled);

    // EVERYTHING in this solver must be in the MARKETPLACE's currency, because that is what the
    // engine compares against: competitor offers arrive in it and prices are submitted in it. The
    // Amazon fees below already are. Our COGS is held in EUR, so convert it here — otherwise a UK
    // floor would be EUR cost + GBP fees, a figure in no currency at all, and ~17% adrift of the
    // GBP prices it is clamped against. No rate ⇒ exclude; never guess a floor (§4.3).
    const ccy = (row.currency ?? 'EUR').toUpperCase();
    const eurPerUnit = ccy === 'EUR' ? 1 : await this.fx.toEur(ccy);
    if (eurPerUnit == null || !(eurPerUnit > 0)) return this.exclude(row.id, 'FX_UNKNOWN', humanControlled);
    // toEur gives native→EUR; we need EUR→native, hence the reciprocal.
    const cogsLandedCents = eurToCents(Number(cogsEur) / eurPerUnit);

    // --- Per-SKU fixed fees: latest getMyFeesEstimate result (fees are DATA, §4.3) ---
    // Unknown fees ⇒ EXCLUDED. FBM has no FBA fulfilment fee; FBM ship cost belongs in fixed costs
    // (not modelled until the fee client lands — see refreshFees below).
    const fee = await this.prisma.repricingFeeEstimate.findFirst({
      where: { sku: row.sku, marketplaceId: row.marketplaceId },
      orderBy: { fetchedAt: 'desc' },
    });
    const isFba = row.fulfillment === 'FBA' || row.fulfillment === 'SFP';
    if (isFba && !fee) return this.exclude(row.id, 'FEES_UNKNOWN', humanControlled);

    const schedule = referralScheduleFor(null); // per-category tiers pending finance sign-off (§9-#20)
    assertValidSchedule(schedule);

    // FBM has no Amazon fulfilment fee — WE ship it, and that carrier charge is a per-unit cost.
    // Omitting it understated the floor badly (a 5 kg parcel can cost as much as the goods), so an
    // FBM SKU with no resolvable shipping is excluded rather than given a too-low floor.
    let fixedPerUnitCents = 0;
    if (!isFba) {
      if (unit.shippingEur == null) return this.exclude(row.id, 'SHIP_UNKNOWN', humanControlled);
      fixedPerUnitCents = eurToCents(unit.shippingEur / eurPerUnit);
    }

    const inputs: FloorInputs = {
      vatRate,
      referralBrackets: schedule,
      fbaFulfillmentFeeCents: isFba ? fee?.fbaFulfillmentFeeCents ?? 0 : 0,
      closingFeeCents: fee?.closingFeeCents ?? 0,
      cogsLandedCents,
      fixedPerUnitCents,
      searchHiCents: row.amazonMaxAllowedCents ?? undefined,
    };

    const minMarginPct = row.minMarginPct != null ? Number(row.minMarginPct) / 100 : REPRICING_DEFAULTS.minMarginPct;
    const { breakevenCents, strategyFloorCents } = solveFloors(inputs, minMarginPct);
    if (breakevenCents == null || strategyFloorCents == null) {
      return this.exclude(row.id, 'FLOOR_INFEASIBLE', humanControlled);
    }

    const now = new Date();
    const staleAfter = new Date(now.getTime() + REPRICING_DEFAULTS.floorStalenessDays * 24 * 60 * 60 * 1000);

    await this.prisma.repricingSkuPricing.update({
      where: { id: row.id },
      data: {
        breakevenCents,
        strategyFloorCents,
        floorsComputedAt: now,
        floorStaleAfter: staleAfter,
        floorInputsHash: this.hashInputs(inputs, minMarginPct),
        exclusionReason: null,
        // Promote a previously input-blocked SKU into shadow; leave LIVE/human states untouched.
        automationState: !humanControlled && row.automationState === 'EXCLUDED' ? 'SHADOW' : row.automationState,
      },
    });
  }

  /** Exclude a SKU from automation with a reason; never touches human-controlled states. */
  private async exclude(id: string, reason: ExclusionReason, humanControlled: boolean): Promise<void> {
    this.logger.warn(`SKU pricing ${id} excluded from automation: ${reason}`);
    await this.prisma.repricingSkuPricing.update({
      where: { id },
      data: {
        exclusionReason: reason,
        ...(humanControlled ? {} : { automationState: 'EXCLUDED' }),
      },
    });
  }

  /** Deterministic hash of the fee+cost inputs, for the audit trail (§4.1 floors.inputsHash). */
  private hashInputs(inputs: FloorInputs, minMarginPct: number): string {
    return createHash('sha256').update(JSON.stringify({ inputs, minMarginPct })).digest('hex').slice(0, 16);
  }

  // -------------------------------------------------------------------------
  // Scheduled maintenance
  // -------------------------------------------------------------------------

  /** Nightly fee refresh + floor recompute (spec §4.3) — every non-deleted SKU × marketplace. 02:00.
   *  Fees are refreshed best-effort; a fee-refresh failure still recomputes on the last known fees. */
  @Cron('0 2 * * *')
  async nightlyRecompute(): Promise<void> {
    const rows = await this.prisma.repricingSkuPricing.findMany({
      where: { deletedAt: null },
      select: { id: true, sku: true, asin: true, marketplaceId: true, currency: true, fulfillment: true, currentPriceCents: true },
    });
    this.logger.log(`Nightly fee refresh + floor recompute for ${rows.length} SKU×marketplace rows.`);
    for (const row of rows) {
      await this.fees.refreshFeesForSku(row).catch((e) =>
        this.logger.error(`Fee refresh failed for ${row.id}: ${e?.message ?? e}`),
      );
      await this.computeFloorsForSku(row.id).catch((e) =>
        this.logger.error(`Floor recompute failed for ${row.id}: ${e?.message ?? e}`),
      );
    }
  }

  /** Hourly staleness sweep — a floor past its horizon auto-excludes (spec §4.3, §7). */
  @Cron('0 * * * *')
  async staleFloorSweep(): Promise<void> {
    const now = new Date();
    const stale = await this.prisma.repricingSkuPricing.updateMany({
      where: {
        deletedAt: null,
        floorStaleAfter: { lt: now },
        automationState: { in: ['SHADOW', 'LIVE'] },
      },
      data: { automationState: 'EXCLUDED', exclusionReason: 'FLOOR_STALE' },
    });
    if (stale.count > 0) this.logger.warn(`Auto-excluded ${stale.count} SKUs on stale floors.`);
  }

  /** Nightly dedupe-table TTL sweep — Postgres has no native TTL (spec §2.2). 03:00. */
  @Cron('0 3 * * *')
  async purgeExpiredDedupe(): Promise<void> {
    const { count } = await this.prisma.repricingNotifDedupe.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) this.logger.log(`Purged ${count} expired notification-dedupe rows.`);
  }

  /**
   * Refresh per-SKU fees from Amazon's getMyFeesEstimate (Product Fees API) → RepricingFeeEstimate
   * (spec §4.3), then recompute the floor. Delegates the SP-API call to FeeService (Pricing role).
   */
  async refreshFeesAndRecompute(skuPricingId: string): Promise<void> {
    const row = await this.prisma.repricingSkuPricing.findUnique({
      where: { id: skuPricingId },
      select: { sku: true, asin: true, marketplaceId: true, currency: true, fulfillment: true, currentPriceCents: true },
    });
    if (!row) return;
    await this.fees.refreshFeesForSku(row);
    await this.computeFloorsForSku(skuPricingId);
  }
}
