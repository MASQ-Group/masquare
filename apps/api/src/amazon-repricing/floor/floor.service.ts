import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { VatService } from './vat.service';
import { FeeService } from './fee.service';
import { FloorInputs, netRevenueCents, solveFloors } from './floor-solver';
import { describeCompleteness, resolveReturnsRate, type ReturnsObservation } from './returns-rate';
import { resolveParams } from '../config/resolve-preset';
import { eurToCents } from '../common/money';
import { PricingFxService } from '../../pricing/fx.service';
import { PricingService } from '../../pricing/pricing.service';
import { MARKETPLACE_TO_ISO, REPRICING_DEFAULTS, toCountryIso } from '../config/repricing.config';
import { assertValidSchedule, referralScheduleFor, scheduleFromChannelFee } from '../config/referral-schedule';
import type { ReferralBracket } from './floor-solver';

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
    const row = await this.prisma.repricingSkuPricing.findUnique({ where: { id: skuPricingId }, include: { preset: true } });
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

    // The same loaded costs the real computation uses. Previewing without them produces a LOWER
    // floor than the stored one and reads as "your stored floor is stale" — sending a user to
    // recompute a SKU whose floor is already correct, and undermining the one control that tells
    // a stale floor from a wrong one.
    const explainReturns = await this.returnsRateFor(row.sku, row.marketplaceId);

    let recomputed: { breakevenCents: number | null; strategyFloorCents: number | null } | null = null;
    if (vatRate != null && cogsLandedCents != null) {
      recomputed = solveFloors(
        {
          vatRate,
          referralBrackets: await this.referralScheduleForMarketplace(row.marketplaceId),
          fbaFulfillmentFeeCents: isFba ? fee?.fbaFulfillmentFeeCents ?? 0 : 0,
          closingFeeCents: fee?.closingFeeCents ?? 0,
          cogsLandedCents,
          fixedPerUnitCents,
          returnsRate: explainReturns.rate,
          refundAdminFeeCents: REPRICING_DEFAULTS.refundAdminFeeCents,
          storagePerUnitCents: row.storagePerUnitCents ?? 0,
          adCostPerUnitCents: row.adCostPerUnitCents ?? 0,
          searchHiCents: row.amazonMaxAllowedCents ?? undefined,
        },
        resolveParams(row, (row as any).preset).minMarginPct,
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
        minMarginPct: resolveParams(row, (row as any).preset).minMarginPctDisplay,
        marginFrom: resolveParams(row, (row as any).preset).marginFrom,
        presetName: resolveParams(row, (row as any).preset).presetName,
        returnsRatePct: explainReturns.rate * 100,
        returnsRateSource: explainReturns.source,
        storagePerUnitCents: row.storagePerUnitCents ?? 0,
        adCostPerUnitCents: row.adCostPerUnitCents ?? 0,
      },
      stored: {
        breakevenCents: row.breakevenCents,
        strategyFloorCents: row.strategyFloorCents,
        floorsComputedAt: row.floorsComputedAt,
        // What this floor accounts for. A floor omitting returns or advertising is fine at a 12%
        // margin and misleading at 2%, and the two look identical without this.
        omits: row.floorOmits ?? [],
        loaded: (row.floorOmits ?? []).length === 0,
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
  /**
   * The referral schedule for one marketplace, taken from the sales channel's own fee.
   *
   * The engine used a hard-coded 15% while Individual Pricing read SalesChannel.generalSalesFeePct.
   * They agreed only because both happened to be 15 — change a channel's fee in Settings and the
   * two screens would have quietly disagreed about the same sale, which is the failure the platform
   * is not allowed to have.
   *
   * Falls back to the built-in schedule when no channel is configured for the marketplace: a guess
   * that is documented beats a floor that cannot be computed at all.
   */
  private async referralScheduleForMarketplace(marketplaceId: string): Promise<ReferralBracket[]> {
    const iso = toCountryIso(MARKETPLACE_TO_ISO[marketplaceId]);
    if (!iso) return referralScheduleFor(null);

    const channel = await this.prisma.salesChannel.findFirst({
      where: { deletedAt: null, nativeCountry: { isoCode: iso }, kind: { not: 'local' } },
      select: { generalSalesFeePct: true },
      orderBy: { createdAt: 'asc' },
    });
    return scheduleFromChannelFee(channel?.generalSalesFeePct != null ? Number(channel.generalSalesFeePct) : null);
  }

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

  /**
   * Price a product for a marketplace it is not listed on yet.
   *
   * Deliberately a method on this service rather than a new one: it reuses the same tax resolution,
   * the same landed COGS from PricingService, the same FX, the same referral schedule and the same
   * solver as `computeFloorsForSku`. A second implementation would be a second answer to "what does
   * this earn", and the platform is supposed to have exactly one.
   *
   * The fee estimate comes by ASIN, because the SKU variant needs a listing that does not exist yet.
   */
  async quoteForNewListing(args: {
    productId: string;
    integrationId: string;
    marketplaceId: string;
    currency: string;
    asin: string;
    isFba: boolean;
    /** Target margin as a fraction. 0.2 = 20%. */
    marginPct: number;
    /**
     * Prices to report the profit of. Several at once on purpose: each call costs one live fee
     * estimate, and evaluating the competition means pricing three or four candidates from the
     * same cost basis.
     */
    atPricesCents?: number[];
  }): Promise<
    | { ok: false; reason: string }
    | {
        ok: true;
        breakevenCents: number;
        suggestedCents: number;
        currency: string;
        marginPct: number;
        /** One entry per price asked about, in the order given. */
        at: Array<{ priceCents: number; profitCents: number; marginPct: number; aboveBreakeven: boolean }>;
        /** What the figure is built on, so a surprising price can be traced without a second call. */
        inputs: {
          cogsLandedCents: number;
          fixedPerUnitCents: number;
          fbaFulfillmentFeeCents: number;
          closingFeeCents: number;
          vatRatePct: number;
          returnsRatePct: number;
        };
      }
  > {
    // Tax resolved the same way as everywhere else: not the country's rate, which is 0% for GB
    // because the real rule lives on the sales channel.
    const tax = await this.channelTax(args.marketplaceId, args.atPricesCents?.[0] ?? null);
    if (tax == null) return { ok: false, reason: 'No VAT rule for this marketplace' };

    const destCountryId = await this.destinationCountryId(args.marketplaceId);
    const unit = await this.pricing.unitCostInputsEur(args.productId, destCountryId);
    if (unit.costEur == null || Number(unit.costEur) <= 0) {
      return { ok: false, reason: 'This product has no purchase cost, so nothing can be priced from it' };
    }

    // Everything the solver sees must be in the marketplace's own currency — Amazon's fees already
    // are, our costs are in EUR.
    const ccy = (args.currency ?? 'EUR').toUpperCase();
    const eurPerUnit = ccy === 'EUR' ? 1 : await this.fx.toEur(ccy);
    if (eurPerUnit == null || !(eurPerUnit > 0)) return { ok: false, reason: `No exchange rate for ${ccy}` };
    const cogsLandedCents = Math.round((Number(unit.costEur) / eurPerUnit) * 100);

    let fixedPerUnitCents = 0;
    if (!args.isFba) {
      if (unit.shippingEur == null) {
        return { ok: false, reason: 'No outbound shipping cost for this destination, so the price would be understated' };
      }
      fixedPerUnitCents = Math.round((unit.shippingEur / eurPerUnit) * 100);
    }

    const fees = await this.fees.estimateForAsin({
      integrationId: args.integrationId,
      asin: args.asin,
      currency: ccy,
      isFba: args.isFba,
      referencePriceCents: args.atPricesCents?.[0] ?? null,
    });
    if (!fees) return { ok: false, reason: 'Amazon would not estimate fees for this listing' };

    const schedule = await this.referralScheduleForMarketplace(args.marketplaceId);
    assertValidSchedule(schedule);

    // Storage and advertising only where the marketplace actually incurs them; returns from our own
    // history. Same rules as a computed floor, so the two agree.
    const marketplaceCosts = await this.prisma.repricingMarketplaceCosts.findUnique({
      where: { marketplaceId: args.marketplaceId },
    });
    const storageApplies = (marketplaceCosts?.storageApplies ?? false) && args.isFba;
    const adsApply = marketplaceCosts?.adsApply ?? false;

    const inputs: FloorInputs = {
      vatRate: tax.vatPct / 100,
      referralBrackets: schedule,
      fbaFulfillmentFeeCents: args.isFba ? fees.fbaFulfillmentFeeCents ?? 0 : 0,
      closingFeeCents: fees.closingFeeCents ?? 0,
      cogsLandedCents,
      fixedPerUnitCents,
      /**
       * No returns allowance in a quoted profit.
       *
       * A repricing FLOOR carries one deliberately: it is a safety line for automated pricing, and
       * a proportion of units really do come back. A quoted profit is a different question — what
       * this sale earns — and a booked sale does not deduct a hypothetical return either. Deducting
       * it here made the product card read 38.9% where Individual Pricing read 40.9% on the same
       * SKU, price and channel, which is exactly the disagreement the platform is not allowed to have.
       *
       * The floors keep theirs. This is the figure a person compares against Individual Pricing.
       */
      returnsRate: 0,
      refundAdminFeeCents: REPRICING_DEFAULTS.refundAdminFeeCents,
      storagePerUnitCents: storageApplies ? marketplaceCosts?.defaultStoragePerUnitCents ?? 0 : 0,
      adCostPerUnitCents: adsApply ? marketplaceCosts?.defaultAdCostPerUnitCents ?? 0 : 0,
    };

    const solved = solveFloors(inputs, args.marginPct);
    // Nulls are how the solver reports infeasibility: no price in the search range clears the
    // deductions. Reported as a reason rather than passed on as a missing number.
    if (solved.breakevenCents == null) {
      return { ok: false, reason: 'No price covers this product’s costs and fees on this marketplace' };
    }
    if (solved.strategyFloorCents == null) {
      return { ok: false, reason: `No price reaches ${Math.round(args.marginPct * 100)}% margin on this marketplace` };
    }

    const at = (args.atPricesCents ?? [])
      .filter((p) => p > 0)
      .map((priceCents) => {
        const profitCents = netRevenueCents(priceCents, inputs);
        return {
          priceCents,
          profitCents,
          // Margin on revenue, the same basis the floor solver targets.
          marginPct: Math.round((profitCents / priceCents) * 1000) / 10,
          aboveBreakeven: profitCents > 0,
        };
      });

    return {
      ok: true,
      breakevenCents: solved.breakevenCents,
      suggestedCents: solved.strategyFloorCents,
      currency: ccy,
      marginPct: Math.round(args.marginPct * 1000) / 10,
      at,
      inputs: {
        cogsLandedCents,
        fixedPerUnitCents,
        fbaFulfillmentFeeCents: inputs.fbaFulfillmentFeeCents ?? 0,
        closingFeeCents: inputs.closingFeeCents ?? 0,
        vatRatePct: tax.vatPct,
        returnsRatePct: Math.round((inputs.returnsRate ?? 0) * 1000) / 10,
      },
    };
  }

  async computeFloorsForSku(skuPricingId: string): Promise<void> {
    const row = await this.prisma.repricingSkuPricing.findUnique({ where: { id: skuPricingId }, include: { preset: true } });
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

    const schedule = await this.referralScheduleForMarketplace(row.marketplaceId);
    assertValidSchedule(schedule);

    // FBM has no Amazon fulfilment fee — WE ship it, and that carrier charge is a per-unit cost.
    // Omitting it understated the floor badly (a 5 kg parcel can cost as much as the goods), so an
    // FBM SKU with no resolvable shipping is excluded rather than given a too-low floor.
    let fixedPerUnitCents = 0;
    if (!isFba) {
      if (unit.shippingEur == null) return this.exclude(row.id, 'SHIP_UNKNOWN', humanControlled);
      fixedPerUnitCents = eurToCents(unit.shippingEur / eurPerUnit);
    }

    // Loaded costs. Returns come from our own history; storage and advertising need data we do
    // not pull, so they are whatever a human has entered and are REPORTED as absent otherwise —
    // a floor that quietly omits them looks identical to one that does not.
    const returns = await this.returnsRateFor(row.sku, row.marketplaceId);
    // Storage and advertising only count where the marketplace actually incurs them. Off by
    // default, so an FBM listing is not held to a storage cost that does not exist.
    const costs = await this.prisma.repricingMarketplaceCosts.findUnique({ where: { marketplaceId: row.marketplaceId } });
    const storageApplies = (costs?.storageApplies ?? false) && isFba;
    const adsApply = costs?.adsApply ?? false;
    const storagePerUnitCents = storageApplies ? row.storagePerUnitCents ?? costs?.defaultStoragePerUnitCents ?? 0 : 0;
    const adCostPerUnitCents = adsApply ? row.adCostPerUnitCents ?? costs?.defaultAdCostPerUnitCents ?? 0 : 0;

    const inputs: FloorInputs = {
      vatRate,
      referralBrackets: schedule,
      fbaFulfillmentFeeCents: isFba ? fee?.fbaFulfillmentFeeCents ?? 0 : 0,
      closingFeeCents: fee?.closingFeeCents ?? 0,
      cogsLandedCents,
      fixedPerUnitCents,
      returnsRate: returns.rate,
      refundAdminFeeCents: REPRICING_DEFAULTS.refundAdminFeeCents,
      storagePerUnitCents,
      adCostPerUnitCents,
      searchHiCents: row.amazonMaxAllowedCents ?? undefined,
    };

    const completeness = describeCompleteness({
      returnsRate: returns.rate,
      returnsSource: returns.source,
      storagePerUnitCents,
      adCostPerUnitCents,
      isFba,
      storageApplies: costs?.storageApplies ?? false,
      adsApply,
    });

    // Per-SKU override, then the named preset the SKU follows, then the global default.
    const minMarginPct = resolveParams(row, (row as any).preset).minMarginPct;
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
        returnsRatePct: returns.rate * 100,
        returnsRateSource: returns.source,
        floorOmits: completeness.omits,
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
  /**
   * How often this SKU comes back, from our own sales history.
   *
   * Counted over a trailing year on the same marketplace: a return rate is a property of the SKU
   * and its audience, and a two-year-old rate describes a product that may no longer be the same
   * one. Falls back to the marketplace's own rate and then to a configured default, because acting
   * on one return out of three units sold would lift that SKU's floor by a third on noise.
   */
  private async returnsRateFor(sku: string, marketplaceId: string) {
    const since = new Date(Date.now() - 365 * 24 * 3600 * 1000);
    const iso = toCountryIso(MARKETPLACE_TO_ISO[marketplaceId] ?? '');

    const rows = await this.prisma.$queryRaw<Array<{ scope: string; sold: number; returned: number }>>`
      SELECT CASE WHEN lower(trim(i.sku)) = ${sku.trim().toLowerCase()} THEN 'sku' ELSE 'marketplace' END AS scope,
             SUM(i.quantity) AS sold,
             SUM(CASE WHEN t.resolution = 'returned' THEN i.quantity ELSE 0 END) AS returned
      FROM sales_transaction_item i
      JOIN sales_transaction t ON t.id = i.transaction_id
      JOIN sales_channel sc ON sc.id = t.sales_channel_id
      LEFT JOIN country c ON c.id = sc.native_country_id
      WHERE i.deleted_at IS NULL AND t.deleted_at IS NULL
        AND t.date >= ${since}
        AND t.status = 'submitted'
        AND c.iso_code = ${iso}
      GROUP BY 1`;

    const pick = (scope: string): ReturnsObservation | null => {
      const r = rows.find((x) => x.scope === scope);
      return r ? { unitsSold: Number(r.sold), unitsReturned: Number(r.returned) } : null;
    };
    // The marketplace row excludes this SKU's own rows, so add them back for the broader figure.
    const own = pick('sku');
    const others = pick('marketplace');
    const marketplace: ReturnsObservation | null =
      own || others
        ? {
            unitsSold: (own?.unitsSold ?? 0) + (others?.unitsSold ?? 0),
            unitsReturned: (own?.unitsReturned ?? 0) + (others?.unitsReturned ?? 0),
          }
        : null;

    return resolveReturnsRate(own, marketplace, REPRICING_DEFAULTS.defaultReturnsRate);
  }

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
