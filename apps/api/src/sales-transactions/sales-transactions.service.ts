import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SerialsService } from '../warehouses/serials.service';
import { StockService } from '../warehouses/stock.service';
import { AvailabilityService } from '../availability/availability.service';
// Type-only: importing the class value here would form a runtime ES-module cycle
// (sales-transactions -> channel-listings -> integrations -> sales-transactions). Resolved at
// call time via ModuleRef using the string token instead.
import type { ChannelListingsService } from '../channel-listings/channel-listings.service';
import type { AuthUser } from '../common/current-user.decorator';
import { CreateSalesTransactionDto, SalesTransactionItemDto, UpdateSalesTransactionDto } from './dto/sales-transaction.dto';

export interface TxQuery {
  q?: string;
  companyId?: string;
  /** Enforced company isolation: the companies the caller may see. */
  companyIds?: string[];
  salesChannelId?: string[];
  destinationCountryId?: string[];
  status?: string[];
  profitTierId?: string[];
  shipmentStatus?: string[]; // 'shipped' | 'not_shipped'
  fulfilmentType?: string[]; // 'FBA' | 'FBM'
  feeType?: string[]; // 'actual' | 'estimated' — actual = a posted/entered fee, estimated = Amazon fee not yet posted
  sku?: string;
  hasAlert?: boolean; // only transactions with an active alert (e.g. unresolved SKU)
  needsReturn?: boolean; // defective (cancel/refund) orders still awaiting the operator's return decision
  resolution?: string[]; // filter by resolution state: none | cancelled | returned | replaced
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'date' | 'profit' | 'profitPct';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

const include = {
  // kind drives the local-sale branches below (pricing, shipping and alerts all differ);
  // showTransactionTotal decides whether a transaction Total is meaningful for this channel.
  salesChannel: { select: { id: true, name: true, kind: true, showTransactionTotal: true, nativeCountry: { select: { isoCode: true } } } },
  destinationCountry: { select: { id: true, name: true, isoCode: true, vatRate: true, euVatZone: true, defaultShippingServiceId: true } },
  shippingService: { select: { id: true, name: true, calcMethod: true } },
  items: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: {
      product: { select: { title: true, packageWeightKg: true, productWeightKg: true, packageLengthCm: true, packageWidthCm: true, packageHeightCm: true, purchaseCostAmount: true, purchaseCostCurrency: true, averageCostEur: true, fulfilmentType: { select: { code: true, name: true } } } },
      vatClass: { select: { id: true, name: true, taxTreatment: true } },
    },
  },
  unlockRequests: { where: { status: 'pending' }, orderBy: { createdAt: 'desc' as const } },
  shipments: {
    where: { deletedAt: null },
    orderBy: { shipmentDate: 'asc' as const },
    include: { shippingService: { select: { id: true, name: true } } },
  },
} satisfies Prisma.SalesTransactionInclude;

/** Destination tax regime, so VAT-submission reports never pull in GST/JCT/US sales tax.
 *  Derived from the destination country; snapshotted on the transaction at sale time. */
export function taxTypeForCountry(c: { isoCode?: string | null; euVatZone?: boolean | null } | null | undefined): string {
  if (!c) return 'none';
  const iso = (c.isoCode ?? '').toUpperCase();
  if (iso === 'JP') return 'jct'; // Japanese Consumption Tax
  if (iso === 'AU') return 'gst'; // Goods and Services Tax
  if (iso === 'US' || iso === 'CA' || iso === 'MX') return 'sales_tax';
  return 'vat'; // EU VAT zone, GB and other VAT markets
}
const TAX_LABELS: Record<string, string> = { vat: 'VAT', gst: 'GST', jct: 'Japanese Consumption Tax', sales_tax: 'Sales tax', none: 'Tax' };
export const taxLabelFor = (taxType: string | null | undefined) => TAX_LABELS[taxType ?? 'vat'] ?? 'VAT';

const n = (v: any) => Number(v ?? 0);

/** Normalise a product/alias fulfilment type (code or name) to FBA/FBM, or null if neither. */
const normFulfil = (ft?: { code?: string | null; name?: string | null } | null): 'FBA' | 'FBM' | null => {
  if (!ft) return null;
  const s = `${ft.code ?? ''} ${ft.name ?? ''}`.toUpperCase();
  if (s.includes('FBA') || s.includes('AMAZON')) return 'FBA';
  if (s.includes('FBM') || s.includes('MERCHANT')) return 'FBM';
  return null;
};
const round = (v: number, d: number) => Number(v.toFixed(d));

/**
 * Historical fee averages used to estimate a channel fee Amazon hasn't posted yet (it settles
 * ~2 weeks after the sale). Both are keyed `sku:channelId`, with a channel-level fallback.
 *   • bySku/byChannel      — referral fee as a RATIO of net sales.
 *   • fbaBySku/fbaByChannel — FBA fulfilment fee as a flat amount PER UNIT (native currency).
 * Without these, an unsettled order books zero cost and its profit reads far too high.
 */
interface FeeEstimateMaps {
  bySku: Map<string, number>;
  byChannel: Map<string, number>;
  fbaBySku: Map<string, number>;
  fbaByChannel: Map<string, number>;
}
/**
 * FBA inbound cost lookups: per channel, and per fulfilment pool.
 *
 *  is keyed p:{productId}:{channelId} / s:{sku}:{channelId}.  is null when no pool is
 * configured, which is the ordinary case and keeps the old behaviour exactly.
 */
interface FbaAvg {
  map: Map<string, number>;
  pools: { avg: Map<string, number>; byChannel: Map<string, { id: string; from: Date | null; to: Date | null }[]> } | null;
}

const EMPTY_FEE_MAPS: FeeEstimateMaps = { bySku: new Map(), byChannel: new Map(), fbaBySku: new Map(), fbaByChannel: new Map() };

@Injectable()
export class SalesTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serials: SerialsService,
    private readonly stock: StockService,
    private readonly availability: AvailabilityService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private readonly logger = new Logger(SalesTransactionsService.name);

  // --- Reference-lookup cache -------------------------------------------------
  // The shipping-service tree, SKU→fulfilment aliases, blended sales-fee ratios and last-known FX
  // rates are near-static reference data, yet were rebuilt on EVERY list / grouped / export /
  // serialize call — two of them (fee %, FX) full-table scans. They only feed FALLBACKS, so a few
  // seconds of staleness is immaterial. Memoise them in-process with a short TTL; mutations that
  // change the underlying data clear the cache so an edit is reflected immediately.
  private static readonly LOOKUP_TTL_MS = 60_000;
  private lookupCache = new Map<string, { at: number; value: unknown }>();
  private async cachedLookup<T>(key: string, build: () => Promise<T>): Promise<T> {
    const hit = this.lookupCache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < SalesTransactionsService.LOOKUP_TTL_MS) return hit.value as T;
    const value = await build();
    this.lookupCache.set(key, { at: now, value });
    return value;
  }
  /** Drop the memoised lookups — call after any write that changes shipping services, SKU
   *  aliases, or the fee/FX history so the next read rebuilds them. */
  invalidateLookupCache() { this.lookupCache.clear(); }
  private cachedServiceMap() { return this.cachedLookup('service', () => this.buildServiceMap()); }
  private cachedSkuFulfilmentMap() { return this.cachedLookup('skuFulfilment', () => this.buildSkuFulfilmentMap()); }
  private cachedFeePctMap() { return this.cachedLookup('feePct', () => this.buildSalesFeePctMap()); }
  private cachedFxFallbackMap() { return this.cachedLookup('fxFallback', () => this.buildFxFallbackMap()); }

  /** Resolved lazily (by string token, no runtime import) to avoid the ES-module cycle
   *  integrations -> sales-transactions -> channel-listings -> integrations. */
  private channelListings(): ChannelListingsService {
    return this.moduleRef.get<ChannelListingsService>('CHANNEL_LISTINGS_SERVICE', { strict: false });
  }

  private serialize(t: any, serviceMap: Map<string, any>, fbaAvgMap: FbaAvg = { map: new Map(), pools: null }, skuFulfilmentMap: Map<string, 'FBA' | 'FBM'> = new Map(), feePctMap: FeeEstimateMaps = EMPTY_FEE_MAPS, fxFallback: Map<string, number> = new Map()) {
    const items = t.items ?? [];
    // FBA: Amazon collects the buyer-paid shipping (it's not the seller's revenue), and there's
    // no seller-paid outbound leg. So for FBA the shipping charged to the buyer is excluded from
    // revenue. `sellShip(it)` is the shipping that counts as seller revenue for this order.
    const isFba = t.fulfilmentType === 'FBA';
    // Unit cost used for COGS, in preference order:
    //   1. the line's explicit override — a deliberate act, so it outranks everything;
    //   2. the cost FROZEN when the sale was created or pulled;
    //   3. the product's moving average — what the goods have actually cost us;
    //   4. the catalogue purchase cost — the best estimate until the first receipt lands.
    //
    // The snapshot is what makes profit point-in-time: a sale is valued with the product data in
    // place when it happened, so re-costing a product applies forward only and never restates a
    // sale already reported. Steps 3 and 4 remain for lines recorded before any cost was known —
    // those keep resolving live until one exists, which preserves the original behaviour of a
    // transaction submitted before its product was ever received.
    //
    // An average of exactly zero is treated as "no average": the costing engine seeds the
    // average from the receipt's unit cost, so a PO booked with no cost would otherwise
    // wipe out a perfectly good catalogue cost and silently report a 100% margin.
    const costSourceOf = (it: any): 'override' | 'snapshot' | 'average' | 'catalogue' | 'none' =>
      it.unitNetCostEur != null ? 'override'
      : it.unitCostSnapshotEur != null ? 'snapshot'
      : Number(it.product?.averageCostEur ?? 0) > 0 ? 'average'
      : it.product?.purchaseCostAmount != null ? 'catalogue' : 'none';
    const unitCostOf = (it: any) => {
      switch (costSourceOf(it)) {
        case 'override': return Number(it.unitNetCostEur);
        case 'snapshot': return Number(it.unitCostSnapshotEur);
        case 'average': return Number(it.product.averageCostEur);
        case 'catalogue': return Number(it.product.purchaseCostAmount);
        default: return 0;
      }
    };
    // Local sale: our own direct sale. No carrier, weight or zone to estimate from — the
    // delivery cost is entered per transaction — and no marketplace fee or FX.
    const isLocal = t.salesChannel?.kind === 'local';
    const sellShip = (it: any) => (isFba ? 0 : n(it.shippingAmount));
    const sellShipVat = (it: any) => (isFba ? 0 : n(it.shippingAmountVat));
    const totals = items.reduce(
      (acc: any, it: any) => ({
        quantity: acc.quantity + n(it.quantity),
        netSales: acc.netSales + n(it.netSalesAmount),
        vat: acc.vat + n(it.vatAmount),
        shipping: acc.shipping + n(it.shippingAmount),
        shippingVat: acc.shippingVat + n(it.shippingAmountVat),
        fee: acc.fee + n(it.salesChannelSalesFeeAmount),
      }),
      { quantity: 0, netSales: 0, vat: 0, shipping: 0, shippingVat: 0, fee: 0 },
    );

    // --- Sales fee: actual, else estimated ------------------------------------
    // Amazon doesn't post the referral fee until settlement (~2 weeks). Until it does, we
    // estimate it per line so revenue/profit aren't overstated: the effective fee % this SKU
    // has actually incurred on this channel (from settled orders), else the channel average,
    // else 15%. Only estimated for Amazon lines with no posted fee; replaced by the real fee
    // once it backfills. `feeInfos[i]` aligns with `items[i]`.
    const chId = t.salesChannelId ?? '';
    const estFeePct = (sku: string) =>
      feePctMap.bySku.get(`${(sku ?? '').trim().toLowerCase()}:${chId}`) ?? feePctMap.byChannel.get(chId) ?? 0.15;
    const feeInfos = items.map((it: any) => {
      const actual = n(it.salesChannelSalesFeeAmount);
      if (actual > 0 || t.source !== 'amazon') return { fee: actual, estimated: 0, isEst: false };
      const estimated = round(n(it.netSalesAmount) * estFeePct(it.sku), 2);
      return { fee: estimated, estimated, isEst: estimated > 0 };
    });
    const effectiveSalesFee = round(feeInfos.reduce((s: number, f: any) => s + f.fee, 0), 2);
    const estimatedSalesFee = round(feeInfos.reduce((s: number, f: any) => s + f.estimated, 0), 2);
    const salesFeeEstimated = feeInfos.some((f: any) => f.isEst);
    // Amazon Points awarded (JP): seller-funded loyalty points — a deduction from our proceeds.
    const amazonPoints = round(items.reduce((s: number, it: any) => s + n(it.amazonPointsAmount), 0), 2);
    // Total tax the channel charged — recorded for reporting/statements only; never used in calcs.
    const salesTax = round(items.reduce((s: number, it: any) => s + n(it.salesTaxAmount), 0), 2);

    // --- Calculated fields ---
    // Sales Fee % = effective fee (actual or estimated) / total (net + vat + shipping + shipping vat).
    const feeBase = items.reduce((s: number, it: any) => s + n(it.netSalesAmount) + n(it.vatAmount) + n(it.shippingAmount) + n(it.shippingAmountVat), 0);
    const salesFeePct = feeBase > 0 ? round((effectiveSalesFee / feeBase) * 100, 2) : null;

    // Destination VAT % — the (editable) stored value, falling back to the country rate.
    const destinationCountryVatPct = t.destinationVatPct ?? (t.destinationCountry ? Number(t.destinationCountry.vatRate) : null);
    // Tax regime: stored snapshot, else derived from the destination country (covers rows
    // saved before the column existed, so the label is always right).
    const taxType = t.taxType ?? taxTypeForCountry(t.destinationCountry);

    // Japan is the one market where the seller KEEPS the destination tax: Amazon pays out the
    // full tax-inclusive amount (net + JCT) and never remits the JCT itself, so the JCT counts
    // as revenue. Under VAT/GST/sales-tax regimes the tax is remitted or collected elsewhere and
    // is excluded from revenue. `revNativeOf` is the per-line revenue (native currency) used
    // everywhere profit is computed, so the treatment stays consistent.
    const keepsDestinationTax = taxType === 'jct';
    const revNativeOf = (it: any) =>
      n(it.netSalesAmount) + sellShip(it) + (keepsDestinationTax ? n(it.vatAmount) + sellShipVat(it) : 0);

    // Overall package weight: sum of per-SKU weight × quantity, by the service's cost basis.
    const method: string | null = t.shippingService?.calcMethod ?? null;
    let overallPackageWeight: number | null = null;
    if (method) {
      let w = 0;
      let any = false;
      for (const it of items) {
        const p = it.product;
        if (!p) continue;
        // Actual package weight (fall back to product weight if the package weight is unset).
        const actual = p.packageWeightKg != null ? Number(p.packageWeightKg) : p.productWeightKg != null ? Number(p.productWeightKg) : null;
        // Volumetric weight = (L × W × H) / 5000.
        const vol = p.packageLengthCm != null && p.packageWidthCm != null && p.packageHeightCm != null
          ? (Number(p.packageLengthCm) * Number(p.packageWidthCm) * Number(p.packageHeightCm)) / 5000
          : null;
        let unit: number | null;
        if (method === 'actual_weight') {
          unit = actual;
        } else {
          // Volumetric services charge on the greater of volumetric and actual weight.
          unit = vol != null && actual != null ? Math.max(vol, actual) : vol ?? actual;
        }
        if (unit != null) { w += unit * n(it.quantity ?? 1); any = true; }
      }
      overallPackageWeight = any ? round(w, 3) : null;
    }

    // Estimated shipping cost: zone of the service the destination belongs to → weight range → charge.
    // Products are usually listed free-shipping for the buyer, but shipping still costs us —
    // so we always apply this estimate (later overridden by the actual from Shipments).
    let estimatedShippingCost: number | null = null;
    // Why the estimate came out empty, so the gap can be reported rather than read as
    // "shipping was free". Null once an estimate is produced.
    let shippingGap: 'no_zone' | 'no_rates' | null = null;
    const svc = t.shippingServiceId ? serviceMap.get(t.shippingServiceId) : null;
    if (isLocal) {
      // We delivered it ourselves (or the buyer collected): the cost is whatever was entered,
      // and a pickup with nothing entered genuinely costs us nothing.
      estimatedShippingCost = n(t.localShippingCostEur);
    } else if (svc && t.destinationCountryId && overallPackageWeight != null) {
      const zone = (svc.zones ?? []).find((z: any) => (z.countries ?? []).some((c: any) => c.countryId === t.destinationCountryId));
      const rates: any[] = (zone?.rates ?? []).slice().sort((a: any, b: any) => Number(a.fromWeightKg) - Number(b.fromWeightKg));
      if (!zone) shippingGap = 'no_zone';
      else if (!rates.length) shippingGap = 'no_rates';
      if (rates.length) {
        const w = overallPackageWeight;
        // Exact band, else clamp to the nearest: under the lightest → lightest band;
        // over the heaviest → heaviest band. Guarantees a shipping cost when the
        // destination is zoned (a very out-of-range weight likely signals bad weight data).
        const exact = rates.find((r) => w >= Number(r.fromWeightKg) && w <= Number(r.toWeightKg));
        const chosen = exact ?? (w < Number(rates[0].fromWeightKg) ? rates[0] : rates[rates.length - 1]);
        estimatedShippingCost = Number(chosen.chargeEur);
      }
    }

    // --- Effective FX ---------------------------------------------------------
    // The stored historical rate, or — when it couldn't be fetched at save time — the last known
    // rate for this currency, so profit still computes (flagged as an estimate). Resolved HERE,
    // before the FBA block, so the fee conversion and the profit calc always use the same rate;
    // reading t.exchangeRate directly would silently drop the FBA fee on a null-FX order.
    const storedFx = t.exchangeRate;
    const fxRate = storedFx ?? (fxFallback.get((t.currency ?? '').toUpperCase()) ?? null);
    const fxEstimated = storedFx == null && fxRate != null;
    const feeFx = t.feeExchangeRate ?? fxRate;

    // --- FBA orders: shipping cost = average inbound-to-Amazon cost + FBA fulfilment fee ---
    // FBA orders aren't shipped via our own services (Amazon fulfils), so the FBM estimate
    // above doesn't apply. Instead: the SKU's average allocated inbound cost to this sales
    // channel (from confirmed FBA Shipments) plus Amazon's FBA fulfilment fee. This becomes
    // the order's "estimated shipping" and feeds the profit calc as the shipping cost.
    let fbaInboundCostEur = 0;
    let fbaFeeEur = 0;
    let fbaFeeEstimated = false;
    if (isFba) {
      const fx = fxRate;
      const feeFxR = feeFx;
      // Like the referral fee, Amazon posts the FBA fulfilment fee only at settlement (~2 weeks).
      // Until then estimate it from this SKU's own average per-unit fee on this channel (else the
      // channel average) — otherwise the order books zero fulfilment fee and reads far too
      // profitable. It's a flat size/weight-tier fee, so the per-unit average is a close proxy,
      // and the real fee replaces it as soon as it backfills.
      const estFbaUnitFee = (sku: string) =>
        feePctMap.fbaBySku.get(`${(sku ?? '').trim().toLowerCase()}:${chId}`) ?? feePctMap.fbaByChannel.get(chId) ?? 0;
      for (const it of items) {
        const avg = this.fbaUnitCost(fbaAvgMap, it, t.salesChannelId, t.date);
        fbaInboundCostEur += avg * n(it.quantity ?? 1);
        if (fx == null) continue;
        const posted = n(it.fbaFulfilmentFeeAmount);
        // Only Amazon-sourced lines get an estimate: a manually keyed order states its own costs.
        const native = posted > 0 || t.source !== 'amazon' ? posted : round(estFbaUnitFee(it.sku) * n(it.quantity ?? 1), 2);
        if (posted <= 0 && native > 0) fbaFeeEstimated = true;
        fbaFeeEur += native * (feeFxR ?? fx);
      }
      fbaInboundCostEur = round(fbaInboundCostEur, 2);
      fbaFeeEur = round(fbaFeeEur, 2);
      estimatedShippingCost = round(fbaInboundCostEur + fbaFeeEur, 2);
    }

    // --- Actual shipment costs (operations records these; they override the estimate) ---
    // Actual shipping cost = company-borne outbound shipments (in EUR). Duty and any
    // company-borne inbound (return) shipping are added as extra costs.
    const shipments = t.shipments ?? [];
    const hasOutbound = shipments.some((s: any) => s.type === 'outbound');
    const outboundCount = shipments.filter((s: any) => s.type === 'outbound').length;
    // An order can go out in several shipments (different tracking, different cost). It is
    // only DONE when the operator says so — the stored status carries that intent, so an
    // order with one shipment of two recorded stays 'partial' and keeps its place in the
    // fulfilment worklist. FBA is fulfilled by the channel, so it's always complete.
    const fullyShipped = isFba || (t.fulfilmentStatus ?? 'pending') === 'shipped';
    const actualShippingCost = hasOutbound
      ? round(shipments.filter((s: any) => s.type === 'outbound' && s.costBorneBy === 'company').reduce((sum: number, s: any) => sum + n(s.shippingCostEur), 0), 2)
      : null;
    const returnShippingCost = round(shipments.filter((s: any) => s.type === 'inbound' && s.costBorneBy === 'company').reduce((sum: number, s: any) => sum + n(s.shippingCostEur), 0), 2);
    const dutyImportCost = round(shipments.reduce((sum: number, s: any) => sum + n(s.dutyImportEur), 0), 2);
    // The shipping cost used in the profit calc: actual (when a shipment exists) else estimated.
    // Local sales are the exception: the delivery cost lives on the transaction
    // (localShippingCostEur), and fulfilling one creates a marker shipment with no cost of its
    // own — so the entered cost must always win, never the marker's €0.
    const shippingCostSource: 'actual' | 'estimated' = isLocal ? 'estimated' : actualShippingCost != null ? 'actual' : 'estimated';
    const effectiveShippingCost = isLocal ? estimatedShippingCost : actualShippingCost != null ? actualShippingCost : estimatedShippingCost;

    // --- Order resolution (returns / cancellations / refunds) ---
    // (Effective FX — storedFx / fxRate / fxEstimated / feeFx — is resolved above the FBA block.)
    const resolution: string = t.resolution ?? 'none';
    // Refund reverses our revenue (net + shipping portion, exc VAT), in native currency.
    const refundEur = t.refundAmount != null && fxRate != null ? round(n(t.refundAmount) * fxRate, 2) : 0;
    // Did the goods actually leave? For a channel order the CHANNEL's word decides, not ours.
    //
    // `hasOutbound` says whether WE recorded a shipment, which answers a different question. An
    // order Amazon cancelled before dispatch has no shipment on either side, but an order we simply
    // have not got round to recording looks identical — and only Amazon knows which it is. Manual
    // sales have no channel status, so there our own record is the only word there is.
    const channelShipped = t.channelShipmentStatus != null ? t.channelShipmentStatus === 'shipped' : hasOutbound;
    // Cancelled before anything shipped → goods never left: no COGS, no shipping, and no money.
    const cancelledPreShip = resolution === 'cancelled' && !channelShipped;
    // COGS is reversed when goods never left, or came back resellable (restock).
    const cogsReversed = cancelledPreShip || (resolution !== 'none' && !!t.restockItems);
    const shippingApplies = !cancelledPreShip;

    // Profit (€): (net + shipping in EUR) − refund − (product cost + effective shipping +
    // return shipping we bear + duty + sales fee in EUR), adjusted for the resolution.
    let profit: number | null = null;
    if (fxRate != null) {
      let revenue = 0;
      let cost = 0;
      for (const it of items) {
        revenue += revNativeOf(it) * fxRate;
        if (!cogsReversed) {
          cost += unitCostOf(it) * n(it.quantity ?? 1);
        }
      }
      if (!t.feeRefunded) cost += effectiveSalesFee * (feeFx ?? fxRate); // actual fee, or estimate while unposted
      cost += amazonPoints * (feeFx ?? fxRate); // Amazon Points (JP) — seller-funded deduction
      revenue -= refundEur;
      if (shippingApplies) cost += effectiveShippingCost ?? 0;
      cost += returnShippingCost + dutyImportCost; // real spends regardless of resolution
      profit = round(revenue - cost, 2);
      // An order cancelled before dispatch earns nothing. The money was either never taken or is
      // certain to go back, and Amazon returns its fee, so the whole thing nets to zero.
      //
      // Reversing the COGS while KEEPING the revenue — which is what this did — reported a
      // cancelled order as MORE profitable than a fulfilled one, because the sale stayed and the
      // cost of goods vanished. A refund would have corrected it, but for an order cancelled before
      // dispatch no refund event ever arrives: Amazon books refunds against a shipment, and there
      // was no shipment.
      if (cancelledPreShip) profit = 0;
    }

    // Profit (%): profit € / seller revenue in € (net + VAT + shipping + shipping VAT).
    // For FBA the buyer-paid shipping isn't seller revenue, so it's excluded from the base too.
    const sellerBaseNative = totals.netSales + totals.vat + (isFba ? 0 : totals.shipping + totals.shippingVat);
    const totalEur = fxRate != null ? sellerBaseNative * fxRate : null;
    const profitPct = profit != null && totalEur != null && totalEur > 0 ? round((profit / totalEur) * 100, 2) : null;

    // EUR revenue/fee figures for analytics (revenue is gross of refunds; profit is net).
    // Zeroed for a cancellation that never shipped, exactly as the profit is. Analytics reads these
    // rather than recomputing, so leaving them intact would keep the sale in every revenue total
    // while the profit said zero — two numbers disagreeing about the same order.
    const revenueExVatEur = fxRate != null ? (cancelledPreShip ? 0 : round((totals.netSales + (isFba ? 0 : totals.shipping)) * fxRate, 2)) : null;
    const revenueIncVatEur = fxRate != null ? (cancelledPreShip ? 0 : round(sellerBaseNative * fxRate, 2)) : null;
    const feesEur = fxRate != null ? (cancelledPreShip ? 0 : round(effectiveSalesFee * (feeFx ?? fxRate) * (t.feeRefunded ? 0 : 1), 2)) : null;
    const estimatedSalesFeeEur = fxRate != null ? round(estimatedSalesFee * (feeFx ?? fxRate), 2) : null;
    const amazonPointsEur = fxRate != null ? round(amazonPoints * (feeFx ?? fxRate), 2) : null;
    const salesTaxEur = fxRate != null ? round(salesTax * fxRate, 2) : null;

    // What the order is WORTH, as opposed to what it was for.
    //
    // A cancellation before dispatch settles at nothing, and that has to hold for every figure a
    // reader might call revenue — not only the EUR ones analytics uses. The list's Net sales column
    // reads these native totals directly, so zeroing the profit and leaving these intact showed an
    // order earning nothing and selling 184.24 in the same row.
    //
    // The line items keep their prices, so what the customer actually ordered is still on the record
    // where it belongs — on the order, not in the revenue.
    const settledTotals = cancelledPreShip
      ? { ...totals, netSales: 0, vat: 0, shipping: 0, shippingVat: 0 }
      : totals;

    // Per-item (SKU) economics: transaction-level shipping/duty/refund are allocated to
    // items by revenue share so per-SKU figures sum back to the transaction totals.
    const totalRevExVatNative = items.reduce((s: number, it: any) => s + n(it.netSalesAmount) + sellShip(it), 0);
    const sharedCostEur = (shippingApplies ? effectiveShippingCost ?? 0 : 0) + returnShippingCost + dutyImportCost;
    const itemEcon = items.map((it: any, idx: number) => {
      const revNative = n(it.netSalesAmount) + sellShip(it);
      const w = totalRevExVatNative > 0 ? revNative / totalRevExVatNative : items.length ? 1 / items.length : 0;
      const revExVatEur = fxRate != null ? round(revNative * fxRate, 2) : null;
      const revIncVatEur = fxRate != null ? round((n(it.netSalesAmount) + n(it.vatAmount) + sellShip(it) + sellShipVat(it)) * fxRate, 2) : null;
      const fEur = fxRate != null ? round((t.feeRefunded ? 0 : feeInfos[idx].fee) * (feeFx ?? fxRate), 2) : null;
      const ptsEur = fxRate != null ? round(n(it.amazonPointsAmount) * (feeFx ?? fxRate), 2) : 0;
      const cEur = cogsReversed ? 0 : round(unitCostOf(it) * n(it.quantity ?? 1), 2);
      // Japan keeps the JCT as revenue (see revNativeOf) — add it back into per-SKU profit so
      // the SKU figures still sum to the transaction profit, while revExVatEur stays true ex-tax.
      const jctKeptEur = fxRate != null && keepsDestinationTax ? round((n(it.vatAmount) + sellShipVat(it)) * fxRate, 2) : 0;
      const pEur = fxRate != null ? round((revExVatEur ?? 0) + jctKeptEur - refundEur * w - cEur - (fEur ?? 0) - (ptsEur ?? 0) - sharedCostEur * w, 2) : null;
      // Per-SKU must agree with the transaction, or a product page reports revenue for an order the
      // order page says earned nothing.
      if (cancelledPreShip) return { revExVatEur: 0, revIncVatEur: 0, fEur: 0, cEur: 0, pEur: 0 };
      return { revExVatEur, revIncVatEur, fEur, cEur, pEur };
    });

    // --- Order alerts (extensible) ---------------------------------------------
    // Each alert = { code, severity, message }; the UI highlights the row and shows
    // the message on hover. Add future checks (price mismatch, missing weight, …) here.
    const alerts: { code: string; severity: 'warning' | 'error'; message: string; items?: string[] }[] = [];
    const unmatchedSkus = [...new Set(items.filter((it: any) => !it.productId).map((it: any) => it.sku).filter(Boolean))] as string[];
    if (unmatchedSkus.length) {
      alerts.push({ code: 'sku_not_found', severity: 'error', message: 'SKU(s) not in the product catalogue', items: unmatchedSkus });
    }
    // Fulfilment mismatch: a SKU labelled FBA/FBM (via its alias, else its product) that
    // contradicts the order's fulfilment type — e.g. an FBA order containing an FBM SKU.
    if (t.fulfilmentType) {
      const wrong = [...new Set(items
        .filter((it: any) => it.productId)
        .filter((it: any) => {
          const label = skuFulfilmentMap.get((it.sku ?? '').trim().toLowerCase()) ?? normFulfil(it.product?.fulfilmentType);
          return label && label !== t.fulfilmentType;
        })
        .map((it: any) => it.sku).filter(Boolean))] as string[];
      if (wrong.length) {
        const other = t.fulfilmentType === 'FBA' ? 'FBM' : 'FBA';
        alerts.push({ code: 'fulfilment_mismatch', severity: 'warning', message: `Fulfilment mismatch — order is ${t.fulfilmentType} but these SKU(s) are ${other}-labelled`, items: wrong });
      }
    }

    // Missing calculation inputs: flag any variable a complete profit/revenue calc relies on
    // that is empty, so silently-incomplete figures surface (unlinked SKUs are covered above).
    const uniq = (arr: any[]): string[] => [...new Set(arr.filter(Boolean))] as string[];
    const prodWeight = (p: any) => (p?.packageWeightKg != null ? Number(p.packageWeightKg) : p?.productWeightKg != null ? Number(p.productWeightKg) : null);
    const linked = items.filter((it: any) => it.productId);
    if (!t.salesChannelId) {
      alerts.push({ code: 'no_sales_channel', severity: 'error', message: 'No sales channel — currency, fees and profit cannot be calculated' });
    } else if (fxRate == null) {
      alerts.push({ code: 'no_exchange_rate', severity: 'error', message: `No exchange rate for ${t.currency ?? 'the order currency'} — EUR revenue and profit cannot be calculated` });
    } else if (fxEstimated) {
      // The FX source was unreachable when this was saved; profit is computed on the last known
      // rate. Recalculate once the source is back to lock in the real historical rate.
      alerts.push({ code: 'estimated_exchange_rate', severity: 'warning', message: `Estimated FX rate for ${t.currency ?? 'this currency'} — the rate source was unavailable when saved. Profit uses the last known rate; Recalculate to finalise.` });
    }
    if (!t.destinationCountryId) {
      alerts.push({ code: 'no_destination_country', severity: 'warning', message: 'No destination country — VAT and shipping zone cannot be determined' });
    }
    // A local sale has no carrier, so "no shipping service" is the normal state, not a gap.
    if (!isFba && !isLocal && !t.shippingServiceId) {
      alerts.push({ code: 'no_shipping_service', severity: 'warning', message: 'No shipping service — outbound shipping cost is not estimated' });
    }
    // A destination outside every zone of the chosen service yields no rate to price
    // against, so shipping silently reads as zero and profit is overstated. Name it.
    if (shippingGap && !isFba && !isLocal) {
      const dest = t.destinationCountry?.name ?? 'the destination country';
      const svcName = svc?.name ?? 'the shipping service';
      alerts.push(
        shippingGap === 'no_zone'
          ? {
              code: 'destination_not_in_zone',
              severity: 'warning',
              message: `${dest} is not in any ${svcName} shipping zone — outbound shipping cost is not estimated`,
            }
          : {
              code: 'zone_has_no_rates',
              severity: 'warning',
              message: `The ${svcName} zone covering ${dest} has no weight-band rates — outbound shipping cost is not estimated`,
            },
      );
    }

    // Purchase cost and unlinked SKUs still matter locally — profit depends on both.
    // "No cost" now means no source at all: no override, no average, no catalogue cost.
    const noCost = uniq(linked.filter((it: any) => costSourceOf(it) === 'none').map((it: any) => it.sku));
    if (noCost.length) alerts.push({ code: 'missing_cost', severity: 'warning', message: 'Missing purchase cost', items: noCost });
    // Deliberately NOT alerted: costing from the catalogue rather than an average is the
    // normal state until a product has been through its first goods receipt, so an alert
    // would fire on every line of every transaction and drown the ones that need action.
    // The distinction is carried per line as `costSource` for the UI to show quietly.
    if (isLocal) {
      // Weight drives the zone/weight-band estimate, which local sales don't use at all.
    } else if (!isFba) {
      const noWeight = uniq(linked.filter((it: any) => prodWeight(it.product) == null).map((it: any) => it.sku));
      if (noWeight.length) alerts.push({ code: 'missing_weight', severity: 'warning', message: 'Missing product weight', items: noWeight });
    } else {
      const noInbound = uniq(linked.filter((it: any) => !(this.fbaUnitCost(fbaAvgMap, it, t.salesChannelId) > 0)).map((it: any) => it.sku));
      if (noInbound.length) alerts.push({ code: 'missing_fba_inbound', severity: 'warning', message: 'No FBA inbound shipment cost recorded', items: noInbound });
    }

    return {
      id: t.id,
      date: t.date,
      transactionRef: t.transactionRef,
      alerts,
      hasAlerts: alerts.length > 0,
      salesChannelId: t.salesChannelId,
      salesChannel: t.salesChannel
        ? { id: t.salesChannel.id, name: t.salesChannel.name, kind: t.salesChannel.kind, showTransactionTotal: t.salesChannel.showTransactionTotal, nativeCountryIso: t.salesChannel.nativeCountry?.isoCode ?? null }
        : null,
      // Local sales: the UI hides FX/fee/carrier fields and shows these instead.
      isLocal,
      deliveryMethod: t.deliveryMethod ?? null,
      localShippingCostEur: t.localShippingCostEur ?? null,
      // As keyed in. The line nets are already net of it — this is for showing it back.
      discountType: t.discountType ?? null,
      discountValue: t.discountValue ?? null,
      discountBase: t.discountBase ?? 'net',
      // What the sale came to: goods + their VAT + any buyer-paid shipping and its VAT, in the
      // transaction currency. Null unless the channel opts in — on a marketplace the channel
      // reports tax its own way (sales tax often overlaps VAT), so one "total" would mislead.
      // For a local sale, shipping is our cost rather than a charge, so this equals net + VAT.
      showTransactionTotal: !!t.salesChannel?.showTransactionTotal,
      transactionTotal: t.salesChannel?.showTransactionTotal
        ? round(settledTotals.netSales + settledTotals.vat + settledTotals.shipping + settledTotals.shippingVat, 2)
        : null,
      destinationCountryId: t.destinationCountryId,
      destinationCountry: t.destinationCountry ? { id: t.destinationCountry.id, name: t.destinationCountry.name, isoCode: t.destinationCountry.isoCode } : null,
      shippingServiceId: t.shippingServiceId,
      shippingService: t.shippingService ? { id: t.shippingService.id, name: t.shippingService.name } : null,
      companyId: t.companyId,
      currency: t.currency,
      feeCurrency: t.feeCurrency,
      exchangeRate: fxRate,
      exchangeRateEstimated: fxEstimated,
      feeExchangeRate: t.feeExchangeRate,
      status: t.status,
      unlockedForEdit: t.unlockedForEdit,
      hasPendingUnlock: (t.unlockRequests ?? []).length > 0,
      salesFeePct,
      // Sales fee: `estimatedSalesFee` fills in for Amazon lines whose referral fee hasn't
      // posted yet; `effectiveSalesFee` = actual (or estimate) used in the calcs; the flag
      // tells the UI to mark it as an estimate. All in the fee currency (EUR variant too).
      estimatedSalesFee,
      estimatedSalesFeeEur,
      effectiveSalesFee,
      salesFeeEstimated,
      // Amazon Points awarded (JP) — a deduction from proceeds (fee currency; EUR variant too).
      amazonPoints,
      amazonPointsEur,
      // Total tax the channel charged (order currency + EUR) — reporting only, not in the calcs.
      salesTax,
      salesTaxEur,
      destinationCountryVatPct,
      // Tax regime for this sale (vat|gst|jct|sales_tax|none) + its display label, so the UI
      // shows "GST"/"Japanese Consumption Tax" and reports separate VAT from other taxes.
      taxType,
      taxLabel: taxLabelFor(taxType),
      vatOverridden: t.vatOverridden,
      overallPackageWeight,
      fulfilmentType: t.fulfilmentType ?? null,
      estimatedShippingCost,
      // The local marker shipment carries no cost, so don't surface its €0 as an "actual".
      actualShippingCost: isLocal ? null : actualShippingCost,
      shippingCostSource,
      // FBA cost breakdown (null for non-FBA) — inbound-to-Amazon avg + Amazon FBA fee.
      fbaInboundCostEur: isFba ? fbaInboundCostEur : null,
      fbaFeeEur: isFba ? fbaFeeEur : null,
      // True while the FBA fee is our estimate (Amazon hasn't settled it yet), mirroring
      // salesFeeEstimated — so the UI can mark the figure as provisional.
      fbaFeeEstimated,
      returnShippingCost,
      dutyImportCost,
      // Platform fulfilment status is derived from shipment registration (the single point
      // of truth), except 'cancelled' which the returns layer sets explicitly. FBA orders
      // are fulfilled by the channel (Amazon) with no action from us — always considered shipped.
      // pending → nothing sent yet · partial → some shipments recorded, more to come ·
      // shipped → the operator marked it complete (or FBA, fulfilled by the channel).
      fulfilmentStatus: resolution === 'cancelled' ? 'cancelled'
        : fullyShipped ? 'shipped'
        : hasOutbound ? 'partial'
        : 'pending',
      outboundShipmentCount: outboundCount,
      // Shipment status reported by the sales channel (for future mismatch alarms).
      channelShipmentStatus: t.channelShipmentStatus ?? null,
      resolution,
      /** 'pending' = cancelled before it ever became an order; 'placed' = cancelled after. */
      cancelStage: t.cancelStage ?? null,
      refundAmount: t.refundAmount,
      refundEur,
      restockItems: t.restockItems,
      feeRefunded: t.feeRefunded,
      resolutionNotes: t.resolutionNotes,
      resolvedAt: t.resolvedAt ?? null,
      // Defective-order handling: where a returned FBM unit went, whether the operator has
      // made the return decision yet, and who set the resolution (operator vs auto-ingested).
      returnWarehouseId: t.returnWarehouseId ?? null,
      returnHandled: t.returnHandled ?? false,
      resolutionSource: t.resolutionSource ?? null,
      integrationId: t.integrationId ?? null,
      shipped: fullyShipped, // complete — a partially-shipped order is NOT shipped yet
      shipments: shipments.map((s: any) => ({
        id: s.id,
        type: s.type,
        shipmentDate: s.shipmentDate,
        shippingService: s.shippingService ?? null,
        trackingNumber: s.trackingNumber,
        shippingCostEur: s.shippingCostEur,
        costBorneBy: s.costBorneBy,
        dutyImportEur: s.dutyImportEur,
        comments: s.comments,
      })),
      profit,
      profitPct,
      revenueExVatEur,
      revenueIncVatEur,
      feesEur,
      items: items.map((it: any, idx: number) => ({
        id: it.id,
        productId: it.productId,
        productTitle: it.product?.title ?? null,
        productMatched: it.product != null, // did the SKU link to a product?
        productCost: it.product?.purchaseCostAmount != null ? Number(it.product.purchaseCostAmount) : null, // catalogue unit cost
        averageCostEur: it.product?.averageCostEur != null ? Number(it.product.averageCostEur) : null, // moving average, once received
        unitNetCostEur: it.unitNetCostEur != null ? Number(it.unitNetCostEur) : null, // per-line override (EUR), if any
        unitCostSnapshotEur: it.unitCostSnapshotEur != null ? Number(it.unitCostSnapshotEur) : null, // cost frozen at sale time
        costSnapshotSource: it.costSnapshotSource ?? null,
        unitCostEur: unitCostOf(it), // what COGS actually used
        costSource: costSourceOf(it), // override | snapshot | average | catalogue | none

        productWeightKg: it.product?.packageWeightKg != null ? Number(it.product.packageWeightKg) : it.product?.productWeightKg != null ? Number(it.product.productWeightKg) : null,
        sku: it.sku,
        quantity: Number(it.quantity),
        netSalesAmount: it.netSalesAmount,
        vatAmount: it.vatAmount,
        // Per-line VAT snapshot (local sales): the rate charged at the time of sale and the
        // class it came from. Reporting needs the treatment to split zero-rated from exempt.
        vatClassId: it.vatClassId ?? null,
        vatClass: it.vatClass ?? null,
        vatRatePct: it.vatRatePct ?? null,
        shippingAmount: it.shippingAmount,
        shippingAmountVat: it.shippingAmountVat,
        salesChannelSalesFeeAmount: it.salesChannelSalesFeeAmount,
        revenueExVatEur: itemEcon[idx].revExVatEur,
        revenueIncVatEur: itemEcon[idx].revIncVatEur,
        feesEur: itemEcon[idx].fEur,
        cogsEur: itemEcon[idx].cEur,
        profitEur: itemEcon[idx].pEur,
      })),
      itemCount: items.length,
      totals: settledTotals,
    };
  }

  /** DB-level WHERE for a transaction query (all filters except the computed ones —
   *  profit tier and hasAlert — which are applied in memory after serialization). */
  private buildWhere(query: TxQuery): Prisma.SalesTransactionWhereInput {
    const and: Prisma.SalesTransactionWhereInput[] = [{ deletedAt: null }];
    if (query.companyIds) and.push({ companyId: { in: query.companyIds } });
    else if (query.companyId) and.push({ companyId: query.companyId });
    if (query.salesChannelId?.length) and.push({ salesChannelId: { in: query.salesChannelId } });
    if (query.destinationCountryId?.length) and.push({ destinationCountryId: { in: query.destinationCountryId } });
    if (query.status?.length) and.push({ status: { in: query.status } });
    if (query.fulfilmentType?.length) and.push({ fulfilmentType: { in: query.fulfilmentType } });
    if (query.sku?.trim()) and.push({ items: { some: { deletedAt: null, sku: { contains: query.sku.trim(), mode: 'insensitive' } } } });
    if (query.resolution?.length) and.push({ resolution: { in: query.resolution } });
    // The return-decision worklist: a refund/cancel that the operator hasn't yet acted on.
    if (query.needsReturn) and.push({ resolution: { not: 'none' }, returnHandled: false });
    if (query.dateFrom) and.push({ date: { gte: new Date(query.dateFrom) } });
    if (query.dateTo) and.push({ date: { lte: new Date(`${query.dateTo}T23:59:59.999Z`) } });
    // Shipment status = a registered outbound shipment OR an FBA order (channel-fulfilled →
    // always shipped for us). Both selected → no filter.
    const ss = query.shipmentStatus ?? [];
    if (ss.length === 1) {
      // Matches the displayed status: an order is shipped only once marked fully shipped (or
      // FBA). A partially-shipped order counts as not shipped — it still owes a shipment.
      if (ss[0] === 'shipped') and.push({ OR: [{ fulfilmentStatus: 'shipped' }, { fulfilmentType: 'FBA' }] });
      else if (ss[0] === 'not_shipped') and.push({ fulfilmentStatus: { not: 'shipped' }, fulfilmentType: { not: 'FBA' } });
    }
    if (query.q) {
      and.push({ OR: [
        { transactionRef: { contains: query.q, mode: 'insensitive' } },
        { items: { some: { deletedAt: null, sku: { contains: query.q, mode: 'insensitive' } } } },
      ] });
    }
    return { AND: and };
  }

  /** All transaction IDs matching a query's filters (ignores pagination) — powers
   *  "select all matching" in the UI. Falls back to serialize when a computed filter is set. */
  async allIds(query: TxQuery): Promise<string[]> {
    const where = this.buildWhere(query);
    if (!query.profitTierId?.length && !query.hasAlert && !query.feeType?.length) {
      const rows = await this.prisma.salesTransaction.findMany({ where, select: { id: true }, orderBy: [{ date: 'desc' }, { transactionRef: 'desc' }] });
      return rows.map((r) => r.id);
    }
    const rows = await this.prisma.salesTransaction.findMany({ where, include });
    const serviceMap = await this.cachedServiceMap();
    const fbaAvgMap = await this.buildFbaAverageMap(rows);
    const skuFulfilmentMap = await this.cachedSkuFulfilmentMap();
    const feePctMap = await this.cachedFeePctMap();
    const fxFallback = await this.cachedFxFallbackMap();
    let all = rows.map((r) => this.serialize(r, serviceMap, fbaAvgMap, skuFulfilmentMap, feePctMap, fxFallback));
    if (query.profitTierId?.length) {
      const tiers = await this.prisma.profitTier.findMany({ where: { id: { in: query.profitTierId } } });
      all = all.filter((t: any) => t.profitPct != null && tiers.some((tier) => t.profitPct >= Number(tier.fromPct) && t.profitPct <= Number(tier.toPct)));
    }
    if (query.hasAlert) all = all.filter((t: any) => t.hasAlerts);
    all = this.applyFeeTypeFilter(all, query);
    return all.map((t: any) => t.id);
  }

  /** Filter serialized rows by fee type: 'actual' = a posted/entered sales fee, 'estimated' =
   *  Amazon referral fee not yet posted (shown with a ~). Both/none selected → no filtering. */
  private applyFeeTypeFilter(rows: any[], query: TxQuery): any[] {
    const want = query.feeType ?? [];
    if (want.length === 0) return rows;
    const wantActual = want.includes('actual');
    const wantEstimated = want.includes('estimated');
    if (wantActual === wantEstimated) return rows; // both or neither → no-op
    return rows.filter((t) => (wantActual ? !t.salesFeeEstimated : t.salesFeeEstimated));
  }

  // Region for the "channel group" rollup (Amazon Europe, eBay Americas, …).
  private static readonly GROUP_ISO_REGION: Record<string, string> = {
    GB: 'Europe', DE: 'Europe', FR: 'Europe', IT: 'Europe', ES: 'Europe', NL: 'Europe', BE: 'Europe', SE: 'Europe', PL: 'Europe', IE: 'Europe', AT: 'Europe', CH: 'Europe',
    US: 'Americas', CA: 'Americas', MX: 'Americas', BR: 'Americas',
    JP: 'Asia-Pacific', AU: 'Asia-Pacific', SG: 'Asia-Pacific',
    AE: 'MENA', SA: 'MENA',
  };
  private channelGroupLabel(name: string | null | undefined, iso: string | null | undefined): { key: string; label: string } {
    const n = (name ?? '').toLowerCase();
    const platform = n.includes('amazon') ? 'Amazon' : n.includes('ebay') ? 'eBay' : n.includes('onbuy') ? 'OnBuy' : (name ? name.split(/[\s-]/)[0] : 'Other');
    const region = SalesTransactionsService.GROUP_ISO_REGION[(iso ?? '').toUpperCase()] ?? 'Other';
    return { key: `${platform}:${region}`, label: `${platform} ${region}` };
  }

  /** Aggregate the transactions matching a query into group rows (orders, units, revenue, profit,
   *  margin) — by channel group, sales channel, SKU, brand or vendor. Channel-level keys aggregate
   *  whole transactions; SKU/brand/vendor aggregate per line item (figures allocated by serialize
   *  sum back to the transaction). Honours every list filter including the computed ones. */
  async grouped(query: TxQuery, groupBy: 'channelGroup' | 'channel' | 'sku' | 'brand' | 'vendor') {
    const where = this.buildWhere(query);
    const rows = await this.prisma.salesTransaction.findMany({ where, include, orderBy: [{ date: 'desc' }] });
    const serviceMap = await this.cachedServiceMap();
    const fbaAvgMap = await this.buildFbaAverageMap(rows);
    const skuFulfilmentMap = await this.cachedSkuFulfilmentMap();
    const feePctMap = await this.cachedFeePctMap();
    const fxFallback = await this.cachedFxFallbackMap();
    let serialized = rows.map((r) => this.serialize(r, serviceMap, fbaAvgMap, skuFulfilmentMap, feePctMap, fxFallback)) as any[];
    // Mirror the list's in-memory filters (profit tier / alerts / fee type).
    if (query.profitTierId?.length) {
      const tiers = await this.prisma.profitTier.findMany({ where: { id: { in: query.profitTierId } } });
      serialized = serialized.filter((t) => t.profitPct != null && tiers.some((tier) => t.profitPct >= Number(tier.fromPct) && t.profitPct <= Number(tier.toPct)));
    }
    if (query.hasAlert) serialized = serialized.filter((t) => t.hasAlerts);
    serialized = this.applyFeeTypeFilter(serialized, query);
    const rowById = new Map(rows.map((r) => [r.id, r]));

    // Brand/vendor for the item-level groupings.
    const productIds = [...new Set(rows.flatMap((r) => (r.items ?? []).map((i: any) => i.productId).filter(Boolean)))] as string[];
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, brand: { select: { name: true } }, vendor: { select: { name: true } } } }) : [];
    const brandOf = new Map(products.map((p) => [p.id, p.brand?.name ?? null]));
    const vendorOf = new Map(products.map((p) => [p.id, p.vendor?.name ?? null]));

    type Agg = { key: string; label: string; orders: Set<string>; units: number; revenueEur: number; profitEur: number };
    const agg = new Map<string, Agg>();
    const bump = (key: string, label: string, orderId: string, units: number, revenue: number | null, profit: number | null) => {
      let a = agg.get(key);
      if (!a) { a = { key, label, orders: new Set(), units: 0, revenueEur: 0, profitEur: 0 }; agg.set(key, a); }
      a.orders.add(orderId); a.units += units; a.revenueEur += revenue ?? 0; a.profitEur += profit ?? 0;
    };
    const unitsOf = (t: any) => (t.items ?? []).reduce((s: number, it: any) => s + n(it.quantity), 0);

    for (const t of serialized) {
      if (groupBy === 'channel') {
        bump(t.salesChannelId ?? '__none', t.salesChannel?.name ?? '— No channel', t.id, unitsOf(t), t.revenueExVatEur, t.profit);
      } else if (groupBy === 'channelGroup') {
        const g = this.channelGroupLabel(t.salesChannel?.name, t.salesChannel?.nativeCountry?.isoCode);
        bump(g.key, g.label, t.id, unitsOf(t), t.revenueExVatEur, t.profit);
      } else {
        const row = rowById.get(t.id);
        (t.items ?? []).forEach((it: any, idx: number) => {
          const pid = row?.items?.[idx]?.productId ?? null;
          let key: string, label: string;
          if (groupBy === 'sku') { key = it.sku || '__none'; label = it.sku || '— No SKU'; }
          else if (groupBy === 'brand') { const b = pid ? brandOf.get(pid) : null; key = b ?? '__none'; label = b ?? '— No brand'; }
          else { const v = pid ? vendorOf.get(pid) : null; key = v ?? '__none'; label = v ?? '— No vendor'; }
          bump(key, label, t.id, n(it.quantity), it.revenueExVatEur, it.profitEur);
        });
      }
    }

    const groups = [...agg.values()]
      .map((a) => ({ key: a.key, label: a.label, orders: a.orders.size, units: a.units, revenueEur: round(a.revenueEur, 2), profitEur: round(a.profitEur, 2), marginPct: a.revenueEur > 0 ? round((a.profitEur / a.revenueEur) * 100, 2) : null }))
      .sort((x, y) => y.profitEur - x.profitEur);
    const totals = {
      orders: serialized.length,
      units: serialized.reduce((s, t) => s + unitsOf(t), 0),
      revenueEur: round(serialized.reduce((s, t) => s + (t.revenueExVatEur ?? 0), 0), 2),
      profitEur: round(serialized.reduce((s, t) => s + (t.profit ?? 0), 0), 2),
    };
    return { groupBy, groups, totals };
  }

  /** The transactions belonging to ONE group (its expanded members in the grouped list). Same
   *  filters + serialization as the list; channel/channelGroup match at the order level,
   *  sku/brand/vendor match if any item belongs to the group. Returns full serialized rows. */
  async groupMembers(query: TxQuery, groupBy: 'channelGroup' | 'channel' | 'sku' | 'brand' | 'vendor', groupKey: string) {
    const where = this.buildWhere(query);
    const rows = await this.prisma.salesTransaction.findMany({ where, include, orderBy: [{ date: 'desc' }, { transactionRef: 'desc' }] });
    const serviceMap = await this.cachedServiceMap();
    const fbaAvgMap = await this.buildFbaAverageMap(rows);
    const skuFulfilmentMap = await this.cachedSkuFulfilmentMap();
    const feePctMap = await this.cachedFeePctMap();
    const fxFallback = await this.cachedFxFallbackMap();
    let serialized = rows.map((r) => this.serialize(r, serviceMap, fbaAvgMap, skuFulfilmentMap, feePctMap, fxFallback)) as any[];
    if (query.profitTierId?.length) {
      const tiers = await this.prisma.profitTier.findMany({ where: { id: { in: query.profitTierId } } });
      serialized = serialized.filter((t) => t.profitPct != null && tiers.some((tier) => t.profitPct >= Number(tier.fromPct) && t.profitPct <= Number(tier.toPct)));
    }
    if (query.hasAlert) serialized = serialized.filter((t) => t.hasAlerts);
    serialized = this.applyFeeTypeFilter(serialized, query);
    const rowById = new Map(rows.map((r) => [r.id, r]));

    const productIds = [...new Set(rows.flatMap((r) => (r.items ?? []).map((i: any) => i.productId).filter(Boolean)))] as string[];
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, brand: { select: { name: true } }, vendor: { select: { name: true } } } }) : [];
    const brandOf = new Map(products.map((p) => [p.id, p.brand?.name ?? null]));
    const vendorOf = new Map(products.map((p) => [p.id, p.vendor?.name ?? null]));

    const inGroup = (t: any): boolean => {
      if (groupBy === 'channel') return (t.salesChannelId ?? '__none') === groupKey;
      if (groupBy === 'channelGroup') return this.channelGroupLabel(t.salesChannel?.name, t.salesChannel?.nativeCountry?.isoCode).key === groupKey;
      const row = rowById.get(t.id);
      return (t.items ?? []).some((it: any, idx: number) => {
        const pid = row?.items?.[idx]?.productId ?? null;
        if (groupBy === 'sku') return (it.sku || '__none') === groupKey;
        if (groupBy === 'brand') return ((pid ? brandOf.get(pid) : null) ?? '__none') === groupKey;
        return ((pid ? vendorOf.get(pid) : null) ?? '__none') === groupKey;
      });
    };
    return serialized.filter(inGroup);
  }

  async list(query: TxQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 50));
    const where = this.buildWhere(query);
    const dir = query.sortDir === 'asc' ? 1 : -1;
    const sortBy = query.sortBy === 'profit' || query.sortBy === 'profitPct' ? query.sortBy : 'date';

    // Profit / profit % are computed fields, so sorting or filtering by them happens
    // in memory over the whole filtered set before paginating.
    if (sortBy !== 'date' || query.profitTierId?.length || query.hasAlert || query.feeType?.length) {
      const rows = await this.prisma.salesTransaction.findMany({ where, include, orderBy: [{ date: query.sortDir === 'asc' ? 'asc' : 'desc' }, { transactionRef: query.sortDir === 'asc' ? 'asc' : 'desc' }] });
      const serviceMap = await this.cachedServiceMap();
      const fbaAvgMap = await this.buildFbaAverageMap(rows);
      const skuFulfilmentMap = await this.cachedSkuFulfilmentMap();
      const feePctMap = await this.cachedFeePctMap();
      const fxFallback = await this.cachedFxFallbackMap();
      let all = rows.map((r) => this.serialize(r, serviceMap, fbaAvgMap, skuFulfilmentMap, feePctMap, fxFallback));
      if (query.profitTierId?.length) {
        const tiers = await this.prisma.profitTier.findMany({ where: { id: { in: query.profitTierId } } });
        all = all.filter((t: any) => t.profitPct != null && tiers.some((tier) => t.profitPct >= Number(tier.fromPct) && t.profitPct <= Number(tier.toPct)));
      }
      if (query.hasAlert) all = all.filter((t: any) => t.hasAlerts);
      all = this.applyFeeTypeFilter(all, query);
      if (sortBy !== 'date') {
        all.sort((a: any, b: any) => {
          const av = a[sortBy]; const bv = b[sortBy];
          if (av == null && bv == null) return 0;
          if (av == null) return 1; // nulls last regardless of direction
          if (bv == null) return -1;
          return (av - bv) * dir;
        });
      }
      return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesTransaction.count({ where }),
      this.prisma.salesTransaction.findMany({ where, include, orderBy: [{ date: dir === 1 ? 'asc' : 'desc' }, { transactionRef: dir === 1 ? 'asc' : 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const serviceMap = await this.cachedServiceMap();
    const fbaAvgMap = await this.buildFbaAverageMap(rows);
    const skuFulfilmentMap = await this.cachedSkuFulfilmentMap();
    const feePctMap = await this.cachedFeePctMap();
    const fxFallback = await this.cachedFxFallbackMap();
    return { items: rows.map((r) => this.serialize(r, serviceMap, fbaAvgMap, skuFulfilmentMap, feePctMap, fxFallback)), total, page, pageSize };
  }

  /** Every filtered transaction, fully serialized and sorted — no pagination. Backs the
   *  export (the list endpoint caps pageSize at 500). Applies the same computed filters/sort
   *  as list() so the file matches exactly what the filtered view shows. */
  async exportRows(query: TxQuery) {
    const where = this.buildWhere(query);
    const dir = query.sortDir === 'asc' ? 1 : -1;
    const sortBy = query.sortBy === 'profit' || query.sortBy === 'profitPct' ? query.sortBy : 'date';
    const rows = await this.prisma.salesTransaction.findMany({ where, include, orderBy: [{ date: dir === 1 ? 'asc' : 'desc' }, { transactionRef: dir === 1 ? 'asc' : 'desc' }] });
    const serviceMap = await this.cachedServiceMap();
    const fbaAvgMap = await this.buildFbaAverageMap(rows);
    const skuFulfilmentMap = await this.cachedSkuFulfilmentMap();
    const feePctMap = await this.cachedFeePctMap();
    const fxFallback = await this.cachedFxFallbackMap();
    let all = rows.map((r) => this.serialize(r, serviceMap, fbaAvgMap, skuFulfilmentMap, feePctMap, fxFallback));
    if (query.profitTierId?.length) {
      const tiers = await this.prisma.profitTier.findMany({ where: { id: { in: query.profitTierId } } });
      all = all.filter((t: any) => t.profitPct != null && tiers.some((tier) => t.profitPct >= Number(tier.fromPct) && t.profitPct <= Number(tier.toPct)));
    }
    if (query.hasAlert) all = all.filter((t: any) => t.hasAlerts);
    all = this.applyFeeTypeFilter(all, query);
    if (sortBy !== 'date') {
      all.sort((a: any, b: any) => {
        const av = a[sortBy]; const bv = b[sortBy];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * dir;
      });
    }
    return all;
  }

  async get(id: string) {
    const t = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null }, include });
    if (!t) throw new NotFoundException('Sales transaction not found');
    const serviceMap = await this.cachedServiceMap();
    const fbaAvgMap = await this.buildFbaAverageMap([t]);
    const skuFulfilmentMap = await this.cachedSkuFulfilmentMap();
    const feePctMap = await this.cachedFeePctMap();
    const fxFallback = await this.cachedFxFallbackMap();
    const out = this.serialize(t, serviceMap, fbaAvgMap, skuFulfilmentMap, feePctMap, fxFallback);

    // Attach the units this transaction consumed, so reopening it shows what left.
    // Only the detail view needs them, so the list paths stay untouched.
    const assigned = await this.prisma.serialNumber.findMany({
      where: { salesTransactionId: id },
      select: { productId: true, serial: true },
      orderBy: { serial: 'asc' },
    });
    if (assigned.length) {
      const byProduct = new Map<string, string[]>();
      for (const a of assigned) byProduct.set(a.productId, [...(byProduct.get(a.productId) ?? []), a.serial]);
      out.items = out.items.map((it: any) => ({ ...it, serials: it.productId ? byProduct.get(it.productId) ?? [] : [] }));
    }
    return out;
  }

  /** All serialized transactions in a date range (for analytics/reporting). */

  /**
   * What one product has actually done, from booked sales.
   *
   * The Channel Listings product page shipped with sample figures standing in for these. A number
   * labelled SAMPLE is at best ignored and at worst believed, so the ones that can be computed are
   * computed and the ones that cannot were removed rather than left as decoration.
   *
   * Built on allInRange, which is the same reader analytics uses, so every EUR figure here is the
   * platform's canonical one rather than a second derivation of it.
   *
   * Cancelled orders are excluded outright — they are not sales. Returns stay in the unit and
   * revenue counts, because the sale did happen, and are reported separately as a rate.
   */
  async productMetrics(
    sku: string,
    companyIds?: string[],
    range?: { from?: string | null; to?: string | null },
  ) {
    const now = new Date();
    /**
     * Twelve months by default, not thirty days.
     *
     * The question this page answers is "does this sell, and at what". A thirty-day window reads
     * zero for every product whenever the last import is a few weeks old, which says nothing about
     * the product and everything about the sync. A caller can ask for any window instead.
     */
    const from = range?.from ? new Date(`${range.from}T00:00:00.000Z`) : new Date(now.getTime() - 365 * 86_400_000);
    const to = range?.to ? new Date(`${range.to}T23:59:59.999Z`) : now;
    const from30 = from;
    const txns = await this.allInRange(from, to, companyIds);
    let lastSoldAt: Date | null = null;

    const num = (v: unknown) => Number(v ?? 0);
    let units = 0, revenue = 0, fees = 0, profit = 0, returnedUnits = 0, orders = 0;
    const weeks = new Array(8).fill(0);
    const byChannel = new Map<string, { name: string; units: number; revenueEur: number; profitEur: number }>();

    for (const t of txns as any[]) {
      const items = (t.items ?? []).filter((it: any) => it.sku === sku);
      if (!items.length) continue;
      if (t.resolution === 'cancelled') continue;

      const date = new Date(t.date);
      if (!lastSoldAt || date > lastSoldAt) lastSoldAt = date;
      // Eight buckets counted back from today, oldest first so it reads left to right as time.
      const weeksAgo = Math.floor((to.getTime() - date.getTime()) / (7 * 86_400_000));
      const inLast30 = date >= from30;
      if (inLast30) orders += 1;

      for (const it of items) {
        const qty = num(it.quantity);
        if (weeksAgo >= 0 && weeksAgo < 8) weeks[7 - weeksAgo] += qty;
        if (!inLast30) continue;

        units += qty;
        revenue += num(it.revenueExVatEur);
        fees += num(it.feesEur);
        profit += num(it.profitEur);
        // A resolution other than none/cancelled means the goods came back.
        if (t.resolution && t.resolution !== 'none') returnedUnits += qty;

        const chName = t.salesChannel?.name ?? 'Unknown';
        const key = t.salesChannel?.id ?? chName;
        const cur = byChannel.get(key) ?? { name: chName, units: 0, revenueEur: 0, profitEur: 0 };
        cur.units += qty;
        cur.revenueEur += num(it.revenueExVatEur);
        cur.profitEur += num(it.profitEur);
        byChannel.set(key, cur);
      }
    }

    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      /** The window actually used, echoed back so the page can label what it is showing. */
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      windowDays: Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000)),
      /**
       * When this product last sold. Without it a zero is ambiguous — "nobody wants it" and "no
       * sales have been imported lately" look identical, and they call for opposite responses.
       */
      lastSoldAt: lastSoldAt ? (lastSoldAt as Date).toISOString() : null,
      unitsSold: r2(units),
      /** Net of channel fees — the only revenue figure comparable across channels that charge differently. */
      revenueEur: r2(revenue - fees),
      profitEur: r2(profit),
      /** Weighted by units. An average of prices is not a real number. */
      avgSellPriceEur: units > 0 ? r2((revenue - fees) / units) : null,
      returnRatePct: units > 0 ? Math.round((returnedUnits / units) * 1000) / 10 : null,
      returnedUnits: r2(returnedUnits),
      orders,
      /** Eight weeks, oldest first. */
      weeklyUnits: weeks.map(r2),
      byChannel: [...byChannel.values()]
        .map((v) => ({ name: v.name, units: r2(v.units), revenueEur: r2(v.revenueEur), profitEur: r2(v.profitEur) }))
        .sort((a, b) => b.units - a.units),
    };
  }

  async allInRange(from: Date, to: Date, companyIds?: string[]) {
    const rows = await this.prisma.salesTransaction.findMany({
      where: { deletedAt: null, date: { gte: from, lte: to }, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      include,
      orderBy: { date: 'asc' },
    });
    const serviceMap = await this.cachedServiceMap();
    const fbaAvgMap = await this.buildFbaAverageMap(rows);
    const skuFulfilmentMap = await this.cachedSkuFulfilmentMap();
    const feePctMap = await this.cachedFeePctMap();
    const fxFallback = await this.cachedFxFallbackMap();
    return rows.map((r) => this.serialize(r, serviceMap, fbaAvgMap, skuFulfilmentMap, feePctMap, fxFallback));
  }

  /** Shipping services with zones (countries + rates) for shipping-cost estimation. */
  private async buildServiceMap() {
    const services = await this.prisma.shippingService.findMany({
      where: { deletedAt: null },
      include: { zones: { where: { deletedAt: null }, include: { countries: true, rates: { where: { deletedAt: null } } } } },
    });
    return new Map<string, any>(services.map((s) => [s.id, s]));
  }

  /** Most recent successfully-stored EUR rate per currency — the "last known rate". When a
   *  transaction was saved while the FX source was unreachable (exchangeRate is null), the read
   *  model falls back to this so revenue/profit still compute (flagged as an estimate); a later
   *  Recalculate re-fetches the real historical rate once the source is back. */
  private async buildFxFallbackMap(): Promise<Map<string, number>> {
    // Latest known rate per currency, computed in the DB (DISTINCT ON) — one row per currency
    // instead of loading every FX-bearing transaction and picking the first in JS.
    const rows = await this.prisma.$queryRaw<Array<{ cur: string; rate: number }>>`
      SELECT DISTINCT ON (upper(currency)) upper(currency) AS cur, exchange_rate AS rate
      FROM sales_transaction
      WHERE deleted_at IS NULL AND exchange_rate IS NOT NULL AND currency IS NOT NULL AND currency <> ''
      ORDER BY upper(currency), date DESC`;
    const map = new Map<string, number>();
    for (const r of rows) if (r.cur && r.rate != null) map.set(r.cur, Number(r.rate));
    return map;
  }

  /**
   * Freeze COGS onto each line at the moment the sale is recorded.
   *
   * Revenue and profit always use the product data in place when the sale was created or pulled,
   * so a later purchase-cost change applies forward only. `keep` carries the snapshots an existing
   * transaction already has: editing a sale must not re-cost it, and the update path deletes and
   * recreates its lines, which would otherwise silently refresh every one.
   *
   * A line whose product has no cost at all is left null rather than frozen at zero — zero is not
   * a cost, and freezing it would report a 100% margin forever.
   */
  private async freezeUnitCosts<T extends { productId?: string | null; sku?: string | null }>(
    items: T[],
    keep?: Map<string, { eur: number; source: string; at: Date }>,
  ): Promise<Array<T & { unitCostSnapshotEur: number | null; costSnapshotSource: string | null; costSnapshotAt: Date | null }>> {
    const ids = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
    const products = ids.length
      ? await this.prisma.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, averageCostEur: true, purchaseCostAmount: true },
        })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const now = new Date();

    return items.map((i) => {
      const prior = keep?.get(String(i.sku ?? '').trim().toLowerCase());
      if (prior) {
        return { ...i, unitCostSnapshotEur: prior.eur, costSnapshotSource: prior.source, costSnapshotAt: prior.at };
      }
      const p = i.productId ? byId.get(i.productId) : undefined;
      // Same preference order the reader uses, so freezing changes no reported figure.
      const avg = Number(p?.averageCostEur ?? 0);
      if (p && avg > 0) return { ...i, unitCostSnapshotEur: avg, costSnapshotSource: 'average', costSnapshotAt: now };
      if (p?.purchaseCostAmount != null) {
        return { ...i, unitCostSnapshotEur: Number(p.purchaseCostAmount), costSnapshotSource: 'catalogue', costSnapshotAt: now };
      }
      return { ...i, unitCostSnapshotEur: null, costSnapshotSource: null, costSnapshotAt: null };
    });
  }

  /** Average allocated inbound (to-Amazon) cost per unit, keyed `${productId}:${salesChannelId}`,
   *  for the FBA orders in `rows`. Sums each SKU's allocated cost across all FBA shipments to a
   *  channel (draft + confirmed) and divides by the total quantity sent — feeds FBA profit. */
  /**
   * Channels that share a pool of inbound stock, and the shipments that feed each pool.
   *
   * Amazon's Pan-European FBA: stock goes to Italy, Amazon redistributes it, and the sale arrives on
   * Sweden. Inbound cost is recorded per channel, so a Swedish order found nothing and booked no
   * inbound cost at all — an order reading more profitable than it was.
   *
   * The pool average is used even where the selling channel has inbound shipments of its own.
   * Once Amazon commingles the stock the unit that sold cannot be traced to a particular shipment,
   * so an average across the pool is the truthful figure and a direct match is false precision.
   *
   * Judged against the ORDER date: before enrolment an Italian shipment genuinely did not supply
   * Sweden, so historic orders keep the figure that was true for them.
   */
  private async buildFbaPoolMap(productIds: Set<string>, skus: Set<string>) {
    const pools = await this.prisma.fbaFulfilmentPool.findMany({
      where: { deletedAt: null, active: true },
      select: {
        id: true, effectiveFrom: true, effectiveTo: true,
        channels: { select: { salesChannelId: true, receives: true, sells: true } },
      },
    });
    if (pools.length === 0) return null;

    const inboundChannelIds = [...new Set(pools.flatMap((p) => p.channels.filter((c) => c.receives).map((c) => c.salesChannelId)))];
    if (inboundChannelIds.length === 0) return null;

    // Every shipment line into a receiving channel, for the products in question.
    const items = await this.prisma.fbaShipmentItem.findMany({
      where: {
        deletedAt: null,
        shipment: { deletedAt: null, salesChannelId: { in: inboundChannelIds } },
        OR: [
          ...(productIds.size ? [{ productId: { in: [...productIds] } }] : []),
          ...(skus.size ? [{ sku: { in: [...skus] } }] : []),
        ],
      },
      select: { productId: true, sku: true, quantity: true, allocatedCostEur: true, shipment: { select: { salesChannelId: true } } },
    });

    const agg = new Map<string, { cost: number; qty: number }>();
    const add = (key: string, cost: number, qty: number) => {
      const cur = agg.get(key) ?? { cost: 0, qty: 0 };
      cur.cost += cost; cur.qty += qty; agg.set(key, cur);
    };
    for (const p of pools) {
      const receiving = new Set(p.channels.filter((c) => c.receives).map((c) => c.salesChannelId));
      for (const it of items) {
        if (!receiving.has(it.shipment?.salesChannelId ?? '')) continue;
        const cost = it.allocatedCostEur != null ? Number(it.allocatedCostEur) : 0;
        const qty = n(it.quantity);
        if (it.productId) add(`P:${p.id}:p:${it.productId}`, cost, qty);
        if (it.sku) add(`P:${p.id}:s:${String(it.sku).trim().toLowerCase()}`, cost, qty);
      }
    }
    const avg = new Map<string, number>();
    for (const [k, v] of agg) if (v.qty > 0) avg.set(k, round(v.cost / v.qty, 4));

    // Which pools a selling channel may draw on. A channel can sit in more than one.
    const byChannel = new Map<string, { id: string; from: Date | null; to: Date | null }[]>();
    for (const p of pools) {
      for (const c of p.channels) {
        if (!c.sells) continue;
        const list = byChannel.get(c.salesChannelId) ?? [];
        list.push({ id: p.id, from: p.effectiveFrom, to: p.effectiveTo });
        byChannel.set(c.salesChannelId, list);
      }
    }
    return { avg, byChannel };
  }

  private async buildFbaAverageMap(rows: any[]): Promise<FbaAvg> {
    const map = new Map<string, number>();
    const productIds = new Set<string>();
    const skus = new Set<string>();
    for (const r of rows) {
      if (r.fulfilmentType !== 'FBA') continue;
      for (const it of r.items ?? []) { if (it.productId) productIds.add(it.productId); if (it.sku) skus.add(String(it.sku).trim()); }
    }
    if (!productIds.size && !skus.size) return { map, pools: null };
    // Match FBA inbound cost by product AND by SKU: an FBA shipment line that never linked to a
    // product (productId null) would otherwise never match its orders, so its cost is invisible.
    const items = await this.prisma.fbaShipmentItem.findMany({
      where: {
        deletedAt: null, shipment: { deletedAt: null },
        OR: [
          ...(productIds.size ? [{ productId: { in: [...productIds] } }] : []),
          ...(skus.size ? [{ sku: { in: [...skus] } }] : []),
        ],
      },
      select: { productId: true, sku: true, quantity: true, allocatedCostEur: true, shipment: { select: { salesChannelId: true } } },
    });
    const agg = new Map<string, { cost: number; qty: number }>();
    const add = (key: string, cost: number, qty: number) => {
      const cur = agg.get(key) ?? { cost: 0, qty: 0 };
      cur.cost += cost; cur.qty += qty; agg.set(key, cur);
    };
    for (const it of items) {
      const ch = it.shipment?.salesChannelId ?? '';
      const cost = it.allocatedCostEur != null ? Number(it.allocatedCostEur) : 0;
      const qty = n(it.quantity);
      if (it.productId) add(`p:${it.productId}:${ch}`, cost, qty);
      if (it.sku) add(`s:${String(it.sku).trim().toLowerCase()}:${ch}`, cost, qty);
    }
    for (const [key, v] of agg) if (v.qty > 0) map.set(key, round(v.cost / v.qty, 4));
    return { map, pools: await this.buildFbaPoolMap(productIds, skus) };
  }

  /** Per-unit FBA inbound cost for a line: by product first, else by SKU (covers FBA lines that
   *  never linked to a product). Channel-scoped, matching how the cost was recorded. */
  private fbaUnitCost(fba: FbaAvg, it: any, salesChannelId: string | null, orderDate?: Date | null): number {
    const ch = salesChannelId ?? '';
    const sku = String(it.sku ?? '').trim().toLowerCase();

    // A pool wins over the channel's own figure. Once Amazon commingles the stock the unit that sold
    // cannot be traced to a shipment, so the pool average is the truthful number and the direct
    // match is false precision — see buildFbaPoolMap.
    const pools = fba.pools?.byChannel.get(ch) ?? [];
    const when = orderDate ? new Date(orderDate) : null;
    for (const p of pools) {
      if (when && p.from && when < p.from) continue;
      if (when && p.to && when > p.to) continue;
      const hit = (it.productId ? fba.pools!.avg.get(`P:${p.id}:p:${it.productId}`) : undefined)
        ?? fba.pools!.avg.get(`P:${p.id}:s:${sku}`);
      if (hit != null) return hit;
    }

    return (
      (it.productId ? fba.map.get(`p:${it.productId}:${ch}`) : undefined) ??
      fba.map.get(`s:${sku}:${ch}`) ??
      0
    );
  }

  /** SKU (lowercased) → FBA/FBM label from its catalogue alias, when that alias carries a
   *  fulfilment type. FBA variants are typically modelled as aliases (the base product is FBM),
   *  so an order's SKU string, not just its product, determines the label. Products fall back
   *  to their own fulfilment type in serialize. */
  private async buildSkuFulfilmentMap(): Promise<Map<string, 'FBA' | 'FBM'>> {
    const map = new Map<string, 'FBA' | 'FBM'>();
    const aliases = await this.prisma.productSkuAlias.findMany({
      where: { deletedAt: null, fulfilmentTypeId: { not: null } },
      select: { skuValue: true, fulfilmentType: { select: { code: true, name: true } } },
    });
    for (const a of aliases) {
      const label = normFulfil(a.fulfilmentType);
      if (label) map.set(a.skuValue.trim().toLowerCase(), label);
    }
    return map;
  }

  /** Effective referral-fee % (fee ÷ net sales) that SKUs have actually incurred, keyed
   *  `${sku}:${channelId}` and per channel, from all order lines with a POSTED fee. Feeds the
   *  estimated sales fee for Amazon lines whose fee hasn't settled yet. */
  private async buildSalesFeePctMap(): Promise<FeeEstimateMaps> {
    // Blended fee ratio per (sku, channel), aggregated in the DB — one row per sku+channel
    // instead of loading every fee-bearing line item and summing in JS. The per-channel ratio
    // is derived by folding the sku+channel rows together (mathematically identical).
    const rows = await this.prisma.$queryRaw<Array<{ sku: string; ch: string; fee: number; net: number }>>`
      SELECT lower(trim(i.sku)) AS sku, COALESCE(t.sales_channel_id::text, '') AS ch,
             SUM(i.sales_channel_sales_fee_amount) AS fee, SUM(i.net_sales_amount) AS net
      FROM sales_transaction_item i
      JOIN sales_transaction t ON t.id = i.transaction_id
      WHERE i.deleted_at IS NULL AND t.deleted_at IS NULL
        AND i.sales_channel_sales_fee_amount > 0 AND i.net_sales_amount > 0
      GROUP BY lower(trim(i.sku)), COALESCE(t.sales_channel_id::text, '')`;
    const bySku = new Map<string, number>();
    const chAgg = new Map<string, { fee: number; net: number }>();
    for (const r of rows) {
      const fee = Number(r.fee);
      const net = Number(r.net);
      if (net > 0) bySku.set(`${r.sku}:${r.ch}`, fee / net);
      const c = chAgg.get(r.ch) ?? { fee: 0, net: 0 }; c.fee += fee; c.net += net; chAgg.set(r.ch, c);
    }
    const byChannel = new Map<string, number>();
    for (const [k, v] of chAgg) if (v.net > 0) byChannel.set(k, v.fee / v.net);

    // Average FBA fulfilment fee PER UNIT per (sku, channel). Unlike the referral fee this is not
    // a % of price — Amazon charges a flat per-unit fee off the item's size/weight tier, so a
    // per-unit average is both the right basis and very stable. Native currency: a channel has
    // one currency, so keying by channel keeps the amounts comparable.
    const fbaRows = await this.prisma.$queryRaw<Array<{ sku: string; ch: string; fee: number; qty: number }>>`
      SELECT lower(trim(i.sku)) AS sku, COALESCE(t.sales_channel_id::text, '') AS ch,
             SUM(i.fba_fulfilment_fee_amount) AS fee, SUM(i.quantity) AS qty
      FROM sales_transaction_item i
      JOIN sales_transaction t ON t.id = i.transaction_id
      WHERE i.deleted_at IS NULL AND t.deleted_at IS NULL
        AND i.fba_fulfilment_fee_amount > 0 AND i.quantity > 0
      GROUP BY lower(trim(i.sku)), COALESCE(t.sales_channel_id::text, '')`;
    const fbaBySku = new Map<string, number>();
    const fbaChAgg = new Map<string, { fee: number; qty: number }>();
    for (const r of fbaRows) {
      const fee = Number(r.fee);
      const qty = Number(r.qty);
      if (qty > 0) fbaBySku.set(`${r.sku}:${r.ch}`, fee / qty);
      const c = fbaChAgg.get(r.ch) ?? { fee: 0, qty: 0 }; c.fee += fee; c.qty += qty; fbaChAgg.set(r.ch, c);
    }
    const fbaByChannel = new Map<string, number>();
    for (const [k, v] of fbaChAgg) if (v.qty > 0) fbaByChannel.set(k, v.fee / v.qty);

    return { bySku, byChannel, fbaBySku, fbaByChannel };
  }

  private async countryVatRate(countryId: string | null): Promise<number | null> {
    if (!countryId) return null;
    const c = await this.prisma.country.findUnique({ where: { id: countryId }, select: { vatRate: true } });
    return c ? Number(c.vatRate) : null;
  }

  private async resolveShippingService(explicit: string | null | undefined, countryId: string | null) {
    if (explicit) return explicit; // an explicit service was chosen
    // Otherwise fall back to the destination country's default shipping service.
    if (!countryId) return null;
    const c = await this.prisma.country.findUnique({ where: { id: countryId }, select: { defaultShippingServiceId: true } });
    return c?.defaultShippingServiceId ?? null;
  }

  // USD-pegged currencies the ECB (Frankfurter) doesn't publish — derived via USD.
  private static readonly USD_PEG: Record<string, number> = { AED: 3.6725, SAR: 3.75 };

  /** Raw currency -> EUR from the free Frankfurter (ECB) API for a given date. Retries once —
   *  the hosted endpoint (api.frankfurter.dev) occasionally times out on a cold date, and a
   *  second attempt usually hits its cache. */
  private async frankfurterRate(currency: string, date: string): Promise<number | null> {
    const today = new Date().toISOString().slice(0, 10);
    const d = date.slice(0, 10);
    const endpoint = d > today ? 'latest' : d;
    // Frankfurter (ECB) moved from api.frankfurter.app to api.frankfurter.dev/v1 — the old host
    // now 301-redirects and the extra hop times out, which surfaced as "No exchange rate".
    const url = `https://api.frankfurter.dev/v1/${endpoint}?from=${currency}&to=EUR`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const json: any = await res.json();
          const rate = json?.rates?.EUR;
          if (typeof rate === 'number') return rate;
        }
      } catch {
        // timeout / network — fall through to a short backoff and retry
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
    return null;
  }

  /** channel currency -> EUR at the transaction date. ECB currencies come from
   *  Frankfurter directly; USD-pegged ones (AED, SAR) are derived from USD. */
  /**
   * The rate to value a sale at.
   *
   * A channel that converts the order itself and pays out in EUR does not settle at any market
   * rate: eBay's is consistently about 3% below it, which on one US order left 30.56 EUR of profit
   * that was never earned. Where the channel's spread is known, the market rate for the day is
   * discounted by it, so the figure tracks the market while still landing where the money does.
   *
   * A spread rather than a fixed rate because the market rate moves daily and the markup does not.
   */
  private async rateForChannel(channel: any, currency: string | null, date: string): Promise<number | null> {
    const market = await this.fetchExchangeRate(currency, date);
    if (market == null || !currency || currency.toUpperCase() === 'EUR') return market;
    const spread = channel?.fxSpreadPct != null ? Number(channel.fxSpreadPct) : null;
    // A spread at or beyond 100% would zero out or invert revenue; ignore it rather than apply it.
    if (spread == null || !(spread > 0) || spread >= 100) return market;
    return round(market * (1 - spread / 100), 8);
  }

  private async fetchExchangeRate(currency: string | null, date: string): Promise<number | null> {
    if (!currency) return null;
    const cur = currency.toUpperCase();
    if (cur === 'EUR') return 1;
    const peg = SalesTransactionsService.USD_PEG[cur];
    if (peg) {
      const usdEur = await this.rateToEur('USD', date);
      return usdEur != null ? round(usdEur / peg, 6) : null;
    }
    const rate = await this.rateToEur(cur, date);
    return rate != null ? round(rate, 6) : null;
  }

  /** currency -> EUR with provider redundancy: try Frankfurter (ECB, historical) first, then a
   *  second free source if it's unreachable. A single provider outage was leaving transactions
   *  saved with an "estimated" last-known rate; a fallback lets the real rate land at save time. */
  private async rateToEur(currency: string, date: string): Promise<number | null> {
    const primary = await this.frankfurterRate(currency, date);
    if (primary != null) return primary;
    return this.fallbackRateToEur(currency);
  }

  /** Fallback FX source: open.er-api.com (free, no key). Latest rates only — used only when
   *  Frankfurter is down, so a recent sale still gets a real rate instead of an estimate. */
  private async fallbackRateToEur(currency: string): Promise<number | null> {
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const json: any = await res.json();
        const eur = json?.rates?.EUR;
        if (typeof eur === 'number' && eur > 0) return round(eur, 6);
      }
    } catch {
      // network / timeout — give up; caller falls back to the last known rate (estimated).
    }
    return null;
  }

  /** Sales channel row plus its native/fee currencies (snapshotted on the transaction). */
  private async channelInfo(salesChannelId?: string | null) {
    const channel = salesChannelId ? await this.prisma.salesChannel.findUnique({ where: { id: salesChannelId } }) : null;
    const currency = channel?.nativeCurrency ?? null;
    const feeCurrency = channel ? (channel.feeChargedInNativeCurrency ? channel.nativeCurrency ?? null : channel.feeCurrency ?? null) : null;
    return { channel, currency, feeCurrency };
  }

  /**
   * Marketplace VAT threshold rule (e.g. UK £135): the applicable VAT % or null if off.
   *
   * The comparison is against the goods' INTRINSIC value — ex-VAT, excluding shipping and
   * other charges — as HMRC defines the consignment threshold (and as the Pricing module
   * tests). `intrinsicValue` is the sum of the lines' net sales (net = ex-VAT, no shipping).
   */
  private channelVatPct(channel: any, intrinsicValue: number): number | null {
    if (!channel?.vatThresholdEnabled || channel.vatThresholdAmount == null) return null;
    return intrinsicValue <= Number(channel.vatThresholdAmount)
      ? channel.vatBelowThresholdPct ?? null
      : channel.vatAboveThresholdPct ?? null;
  }

  /** Destination VAT %: user override → channel threshold rule → country rate. */
  private async resolveDestinationVat(
    dto: { vatOverridden?: boolean; destinationVatPct?: number | null },
    channel: any,
    intrinsicValue: number,
    destCountryId: string | null,
  ): Promise<{ pct: number | null; overridden: boolean }> {
    if (dto.vatOverridden && dto.destinationVatPct != null) return { pct: dto.destinationVatPct, overridden: true };
    const ruleVat = this.channelVatPct(channel, intrinsicValue);
    if (ruleVat != null) return { pct: ruleVat, overridden: false };
    return { pct: await this.countryVatRate(destCountryId), overridden: false };
  }

  /** Local sales: we are the one charging VAT, so the server owns the number rather than
   *  trusting the client. Resolves each line's class (explicit → the product's default),
   *  computes VAT from the net, and snapshots the rate so a later rate change can't rewrite
   *  history. Marketplace-only amounts (fee, FBA, points, channel tax) are cleared, and
   *  shipping is transaction-level for local sales, not per line. */
  /** What a sale-level discount is actually worth against a given base total (net or gross). */
  private discountAmountFor(type: string | null | undefined, value: number | null | undefined, base: number) {
    if (!type || value == null || value <= 0 || base <= 0) return 0;
    if (type === 'percentage') {
      if (value > 100) throw new BadRequestException('A percentage discount cannot exceed 100%');
      return round(base * (value / 100), 2);
    }
    if (value > base) throw new BadRequestException(`Discount €${value.toFixed(2)} is more than the sale total of €${base.toFixed(2)}`);
    return round(value, 2);
  }

  /** SKU (lowercased) → productId from the current catalogue; main SKU wins over an alias.
   *  Shared by save-time re-linking and the Recalculate button so both resolve SKUs identically.
   *  Pass `skus` to resolve just those (save / per-order import) — the map is only ever looked
   *  up by those SKUs, so scoping the query is behaviour-preserving and avoids loading the whole
   *  product + alias tables on every write. Omit `skus` to load the entire catalogue. */
  private async buildSkuToProduct(skus?: string[]): Promise<Map<string, string>> {
    const norm = skus ? [...new Set(skus.map((s) => (s ?? '').trim()).filter(Boolean))] : null;
    if (norm && norm.length === 0) return new Map();
    const prodWhere: any = { deletedAt: null };
    const aliasWhere: any = { deletedAt: null };
    if (norm) {
      // Case-insensitive match on the handful of SKUs on the current document(s).
      prodWhere.OR = norm.map((s) => ({ mainSku: { equals: s, mode: 'insensitive' as const } }));
      aliasWhere.OR = norm.map((s) => ({ skuValue: { equals: s, mode: 'insensitive' as const } }));
    }
    const [products, aliases] = await Promise.all([
      this.prisma.product.findMany({ where: prodWhere, select: { id: true, mainSku: true } }),
      this.prisma.productSkuAlias.findMany({ where: aliasWhere, select: { productId: true, skuValue: true } }),
    ]);
    const m = new Map<string, string>();
    for (const a of aliases) m.set(a.skuValue.trim().toLowerCase(), a.productId);
    for (const p of products) m.set(p.mainSku.trim().toLowerCase(), p.id);
    return m;
  }

  /** Re-link each line to a product by its SKU against the CURRENT catalogue, so saving a
   *  transaction picks up products added since it was last saved (the same review the
   *  Recalculate button performs). The catalogue link wins; an explicit productId is the
   *  fallback for a SKU the catalogue doesn't know yet. */
  private async linkItemsToCatalogue<T extends { sku: string; productId?: string | null }>(items: T[]): Promise<T[]> {
    const skuMap = await this.buildSkuToProduct(items.map((i) => i.sku));
    return items.map((i) => {
      // `serials` rides along on the DTO but belongs to the serial register, not to the
      // item row — spreading it into the item create would hand Prisma an unknown column.
      const { serials: _ignored, ...rest } = i as T & { serials?: string[] };
      return { ...(rest as T), productId: skuMap.get((i.sku ?? '').trim().toLowerCase()) ?? i.productId ?? null };
    });
  }

  private async resolveLocalVat(
    items: SalesTransactionItemDto[],
    discount?: { type?: string | null; value?: number | null; base?: string | null },
  ) {
    const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean) as string[])];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, vatClassId: true } })
      : [];
    const productVatClass = new Map(products.map((p) => [p.id, p.vatClassId]));

    const classIdFor = (i: SalesTransactionItemDto) =>
      i.vatClassId ?? (i.productId ? productVatClass.get(i.productId) ?? null : null);

    const classIds = [...new Set(items.map(classIdFor).filter(Boolean) as string[])];
    const classes = classIds.length
      ? await this.prisma.vatClass.findMany({ where: { id: { in: classIds }, deletedAt: null }, select: { id: true, ratePct: true } })
      : [];
    const rateById = new Map(classes.map((c) => [c.id, Number(c.ratePct)]));

    // Validate each line and lock in its net + VAT rate + VAT-inclusive gross up front.
    const lineInfo = items.map((i) => {
      const vatClassId = classIdFor(i);
      // Refuse rather than silently charging €0 — a missing class is a real gap, not a zero rate.
      if (!vatClassId) {
        throw new BadRequestException(`Line “${i.sku}” has no VAT class. Choose one, or set a VAT class on the product.`);
      }
      const vatRatePct = rateById.get(vatClassId);
      if (vatRatePct == null) {
        throw new BadRequestException(`Line “${i.sku}” refers to a VAT class that no longer exists.`);
      }
      const net = n(i.netSalesAmount);
      const gross = round(net * (1 + vatRatePct / 100), 2);
      return { i, vatClassId, vatRatePct, net, gross };
    });

    // A sale-level discount is shared out in proportion to each line's weight — its net for a
    // 'net'-base discount, its VAT-inclusive gross for a 'gross'-base one. Sharing by weight
    // keeps the rate split correct on a VAT return; the last line absorbs the rounding
    // remainder so the shares always add back to the discount exactly.
    const onGross = discount?.base === 'gross';
    const base = round(lineInfo.reduce((s, l) => s + (onGross ? l.gross : l.net), 0), 2);
    const discountAmount = this.discountAmountFor(discount?.type, discount?.value, base);
    let allocated = 0;

    return lineInfo.map((l, idx) => {
      const weight = onGross ? l.gross : l.net;
      let share = 0;
      if (discountAmount > 0 && base > 0) {
        share = idx === lineInfo.length - 1 ? round(discountAmount - allocated, 2) : round((weight / base) * discountAmount, 2);
        allocated = round(allocated + share, 2);
      }

      let netSalesAmount: number;
      let vatAmount: number;
      if (onGross) {
        // Take the discount off the VAT-inclusive line, then back out net and VAT at its rate,
        // so the sale total drops by exactly the discount.
        const discountedGross = round(l.gross - share, 2);
        netSalesAmount = round(discountedGross / (1 + l.vatRatePct / 100), 2);
        vatAmount = round(discountedGross - netSalesAmount, 2);
      } else {
        // Take the discount off the net, then charge VAT on the discounted net.
        netSalesAmount = round(l.net - share, 2);
        vatAmount = round(netSalesAmount * (l.vatRatePct / 100), 2);
      }

      return {
        ...l.i,
        productId: l.i.productId ?? null,
        vatClassId: l.vatClassId,
        vatRatePct: l.vatRatePct,
        netSalesAmount,
        vatAmount,
        shippingAmount: null,
        shippingAmountVat: null,
        salesChannelSalesFeeAmount: 0,
        fbaFulfilmentFeeAmount: null,
        amazonPointsAmount: null,
        salesTaxAmount: null,
      };
    });
  }

  /** Destination tax regime for a country id, snapshotted onto the transaction. */
  private async resolveTaxType(countryId: string | null): Promise<string> {
    if (!countryId) return 'none';
    const c = await this.prisma.country.findUnique({ where: { id: countryId }, select: { isoCode: true, euVatZone: true } });
    return taxTypeForCountry(c);
  }

  async create(dto: CreateSalesTransactionDto, actorId?: string) {
    const { channel, currency, feeCurrency } = await this.channelInfo(dto.salesChannelId);
    // A local sale is invoiced by us in EUR: no FX, no marketplace fee, no carrier, and VAT
    // per line from the VAT class instead of a destination/threshold rule.
    const isLocal = channel?.kind === 'local';
    // Save-time review: re-link every line to a product from the current catalogue first.
    const linked = await this.linkItemsToCatalogue(dto.items);
    const items = isLocal
      ? await this.resolveLocalVat(linked, { type: dto.discountType, value: dto.discountValue, base: dto.discountBase })
      : linked;
    const shippingServiceId = isLocal
      ? null
      : await this.resolveShippingService(dto.shippingServiceId, dto.destinationCountryId ?? null);
    const exchangeRate = isLocal ? 1 : await this.rateForChannel(channel, currency, dto.date);
    const feeExchangeRate = isLocal
      ? 1
      : feeCurrency && feeCurrency !== currency ? await this.rateForChannel(channel, feeCurrency, dto.date) : exchangeRate;
    // Intrinsic (ex-VAT, goods-only) value for the marketplace VAT threshold — net sales, no VAT, no shipping.
    const overall = (dto.items ?? []).reduce((s, i) => s + n(i.netSalesAmount), 0);
    // Local VAT lives per line, so the transaction-level destination rate stays null.
    const { pct: destinationVatPct, overridden: vatOverridden } = isLocal
      ? { pct: null, overridden: false }
      : await this.resolveDestinationVat(dto, channel, overall, dto.destinationCountryId ?? null);
    const taxType = isLocal ? 'vat' : await this.resolveTaxType(dto.destinationCountryId ?? null);
    // Refuse an incomplete submission before the row exists, so a rejected transaction
    // leaves nothing behind.
    const serialWork = await this.resolveSerialConsumption(
      (dto.items ?? []).map((i, idx) => ({ productId: linked[idx]?.productId ?? i.productId ?? null, sku: i.sku, quantity: i.quantity, serials: i.serials })),
      dto.status ?? 'draft',
    );

    const t = await this.prisma.salesTransaction.create({
      data: {
        date: new Date(dto.date),
        transactionRef: dto.transactionRef,
        salesChannelId: dto.salesChannelId ?? null,
        destinationCountryId: dto.destinationCountryId ?? null,
        shippingServiceId,
        companyId: dto.companyId ?? null,
        currency: isLocal ? 'EUR' : currency,
        feeCurrency: isLocal ? 'EUR' : feeCurrency,
        exchangeRate,
        feeExchangeRate,
        destinationVatPct,
        vatOverridden,
        taxType,
        deliveryMethod: isLocal ? dto.deliveryMethod ?? null : null,
        localShippingCostEur: isLocal ? dto.localShippingCostEur ?? null : null,
        discountType: isLocal ? dto.discountType ?? null : null,
        discountValue: isLocal ? dto.discountValue ?? null : null,
        discountBase: isLocal ? dto.discountBase ?? 'net' : null,
        status: dto.status ?? 'draft',
        fulfilmentStatus: dto.fulfilmentStatus ?? 'pending',
        channelShipmentStatus: dto.channelShipmentStatus ?? null,
        // FBA exists only on Amazon; default everything else (manual, OnBuy) to FBM.
        fulfilmentType: dto.fulfilmentType ?? 'FBM',
        source: dto.source ?? 'manual',
        integrationId: dto.integrationId ?? null,
        unlockedForEdit: false,
        createdById: actorId,
        updatedById: actorId,
        items: { create: await this.freezeUnitCosts(items) },
      },
    });

    await this.consumeSerials(serialWork, t.id, dto.transactionRef, actorId);
    await this.reconcileSaleStock(t.id, actorId);
    await this.applyAvailabilitySellThrough(t.id, actorId);
    return this.get(t.id);
  }

  /**
   * Serial-tracked items on a submitted transaction.
   *
   * A tracked product is a physical unit we can point at, so a submitted sale must say
   * which units left. Draft transactions are exempt — that is where an order sits while
   * the detail is still being gathered.
   *
   * Returns the work to do once the transaction row exists; nothing is written here.
   */
  private async resolveSerialConsumption(
    items: { productId?: string | null; sku: string; quantity: number; serials?: string[] }[],
    status: string,
  ) {
    const productIds = items.map((i) => i.productId).filter(Boolean) as string[];
    const tracked = await this.serials.trackedProductIds(productIds);
    if (!tracked.size) return [];

    const problems: string[] = [];
    const work: { productId: string; sku: string; serials: string[]; quantity: number }[] = [];

    for (const it of items) {
      if (!it.productId || !tracked.has(it.productId)) continue;
      const given = (it.serials ?? []).map((x) => x.trim()).filter(Boolean);
      if (status !== 'submitted') continue; // a draft may still be incomplete
      if (given.length !== it.quantity) {
        problems.push(`${it.sku}: ${given.length} serial${given.length === 1 ? '' : 's'} for ${it.quantity} unit${it.quantity === 1 ? '' : 's'}`);
        continue;
      }
      work.push({ productId: it.productId, sku: it.sku, serials: given, quantity: it.quantity });
    }

    if (problems.length) {
      throw new BadRequestException(
        `This transaction cannot be submitted without serial numbers — ${problems.join('; ')}.`,
      );
    }
    return work;
  }

  /**
   * Take the named units off the shelf.
   *
   * Serial-tracked stock is the one case where a sale moves inventory: the units are
   * identifiable, so leaving them on hand after they have shipped would be plainly wrong.
   * Untracked products keep the existing behaviour and do not touch stock.
   */
  private async consumeSerials(
    work: { productId: string; sku: string; serials: string[]; quantity: number }[],
    salesTransactionId: string,
    reference: string,
    actorId?: string,
  ) {
    if (!work.length) return;
    try {
      await this.prisma.$transaction(async (tx) => {
      for (const w of work) {
        // Where the units physically are decides which warehouse the stock leaves.
        const rows = await tx.serialNumber.findMany({
          where: { productId: w.productId, serial: { in: w.serials }, status: 'in_stock' },
          select: { warehouseId: true },
        });
        const warehouseId = rows.find((r) => r.warehouseId)?.warehouseId ?? null;

        await this.serials.dispatchWithin(tx, {
          productId: w.productId,
          serials: w.serials,
          to: 'sold',
          salesTransactionId,
        });

        if (warehouseId) {
          await this.stock.applyDeltaWithin(tx, {
            productId: w.productId,
            warehouseId,
            qtyDelta: -w.quantity,
            reason: 'sale',
            reference,
            actorId,
          });
        }
      }
      });
    } catch (err: any) {
      // The transaction row already exists at this point, so a bare 500 would leave the
      // user with a saved sale and no idea why the stock did not move. Say what failed.
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      throw new BadRequestException(`Could not dispatch the serial numbers: ${err?.message ?? err}`);
    }
  }

  /**
   * Bring a sale's physical stock into line with what it should hold, when the
   * "deduct stock on sale" setting is on. Idempotent by construction: each line records how
   * many units it has already taken (stockDeductedQty), so this only ever moves the delta —
   * submit deducts, un-submit or a smaller quantity puts stock back, re-submitting does
   * nothing. Serial-tracked lines are left to the serial path, which already moves their stock.
   *
   * "Committed" per line = units already deducted from stock + units recorded as owed. A sale
   * that ships more than is on hand is never blocked: the shortfall becomes a StockOwed row
   * instead of a hard error, so a channel deadline can be met and the gap chased later.
   *
   * `forceRelease` treats the desired quantity as zero regardless of status — used when a sale
   * is deleted, so its stock is returned before the row goes away.
   */
  private async reconcileSaleStock(txId: string, actorId?: string, opts: { forceRelease?: boolean } = {}) {
    const settings = await this.prisma.platformSettings.findFirst({ select: { deductStockOnSale: true } });
    // When the feature is off, never touch stock — but a delete must still return anything a
    // previous (feature-on) submit had taken, so releases are always honoured.
    if (!settings?.deductStockOnSale && !opts.forceRelease) return;

    const tx = await this.prisma.salesTransaction.findFirst({
      where: { id: txId },
      select: {
        id: true, status: true, transactionRef: true, fulfilmentType: true, resolution: true,
        items: {
          where: { deletedAt: null },
          select: { id: true, sku: true, productId: true, quantity: true, stockDeductedQty: true, stockWarehouseId: true, product: { select: { serialTracked: true } } },
        },
      },
    });
    if (!tx) return;
    // FBA goods live in Amazon's fulfilment centres, never our warehouses — an FBA sale (and
    // its cancellation) must not move local stock.
    if (tx.fulfilmentType === 'FBA') return;
    // A cancelled order's units were never really consumed (Amazon only cancels pre-ship), so
    // any stock the submit reserved is released back.
    const cancelled = tx.resolution === 'cancelled';

    await this.prisma.$transaction(async (db) => {
      for (const it of tx.items) {
        if (!it.productId || it.product?.serialTracked) continue;
        const desired = opts.forceRelease || cancelled || tx.status !== 'submitted'
          ? 0
          : this.wholeUnitsForStock(it.quantity, it.sku, 'stock');
        await this.reconcileSaleLine(db, {
          txId: tx.id, ref: tx.transactionRef, actorId,
          itemId: it.id, productId: it.productId, desired,
          deducted: it.stockDeductedQty, warehouseId: it.stockWarehouseId,
        });
      }
    });
  }

  /**
   * Sell-through: move channel Availability to match the sale, then schedule one push per
   * affected product so every channel is told the new figure. Runs after the sale is saved and
   * never throws back into it — Availability is a convenience mirror, not part of the sale.
   */
  private async applyAvailabilitySellThrough(txId: string, actorId?: string, opts: { forceRelease?: boolean } = {}) {
    try {
      const affected = await this.reconcileSaleAvailability(txId, actorId, opts);
      if (affected.length) this.channelListings().schedulePush(affected);
    } catch (e: any) {
      this.logger.error(`Availability sell-through failed for ${txId}: ${e?.message ?? e}`);
    }
  }

  /**
   * Bring channel Availability into line with what a sale has consumed, when the
   * "auto-adjust availability on sale" setting is on. Availability is the sellable number
   * broadcast to every channel, so this is deliberately channel- and fulfilment-agnostic: an
   * FBA sale and a serial-tracked sale both lower the shared pool (unlike physical stock, which
   * skip those). Idempotent like reconcileSaleStock — each line records availabilityDeductedQty,
   * so a re-submit moves only the delta and an un-submit/cancel adds it back. Returns the affected
   * product ids so the caller can push each once.
   *
   * `forceRelease` treats the desired quantity as zero regardless of status (used on delete), so
   * Availability a previous feature-on submit took is returned even when the setting is now off.
   *
   * Edge: a sale that ships more than was available floors Availability at 0 but still records the
   * full quantity as deducted, so a later cancellation can over-restore by the shortfall. Accepted
   * for v1 — Availability is operator-maintained and a manual correction fixes it.
   */
  private async reconcileSaleAvailability(txId: string, actorId?: string, opts: { forceRelease?: boolean } = {}): Promise<string[]> {
    const settings = await this.prisma.platformSettings.findFirst({ select: { autoAdjustAvailabilityOnSale: true } });
    if (!settings?.autoAdjustAvailabilityOnSale && !opts.forceRelease) return [];

    const tx = await this.prisma.salesTransaction.findFirst({
      where: { id: txId },
      select: {
        id: true, status: true, transactionRef: true, resolution: true,
        items: { where: { deletedAt: null }, select: { id: true, sku: true, productId: true, quantity: true, availabilityDeductedQty: true } },
      },
    });
    if (!tx) return [];
    const cancelled = tx.resolution === 'cancelled';
    const affected = new Set<string>();

    await this.prisma.$transaction(async (db) => {
      for (const it of tx.items) {
        if (!it.productId) continue;
        const desired = opts.forceRelease || cancelled || tx.status !== 'submitted'
          ? 0
          : this.wholeUnitsForStock(it.quantity, it.sku, 'channel availability');
        const move = desired - it.availabilityDeductedQty; // >0 = sell more, <0 = give back
        if (move === 0) continue;
        await this.availability.adjust(
          it.productId, -move, move > 0 ? 'sale' : 'cancellation',
          { refType: 'sales_tx', refId: it.id, note: tx.transactionRef ?? undefined }, actorId, db,
        );
        await db.salesTransactionItem.update({ where: { id: it.id }, data: { availabilityDeductedQty: desired } });
        affected.add(it.productId);
      }
    });
    return [...affected];
  }

  /** One line's reconciliation. See reconcileSaleStock for the model. */
  /**
   * The whole units a stock ledger can carry, or a refusal.
   *
   * Sales lines may be fractional — some goods are sold by length or weight — but stock levels,
   * movements and availability are all integer. Rounding 1.5 into 1 or 2 would put a figure in the
   * stock ledger that no document supports, and nobody would ever find it. Refusing says plainly
   * that the two cannot both be true, and points at the setting that made it a problem.
   */
  private wholeUnitsForStock(quantity: unknown, sku: string, ledger: string): number {
    const n = Number(quantity);
    if (!Number.isFinite(n)) return 0;
    if (!Number.isInteger(n)) {
      throw new BadRequestException(
        `${sku} is sold in fractions (${n}), which cannot be taken off ${ledger} — that ledger holds whole units only. ` +
        `Either sell whole units, or switch off the ${ledger} adjustment in Settings until the stock ledger supports fractions.`,
      );
    }
    return n;
  }

  private async reconcileSaleLine(
    db: Prisma.TransactionClient,
    a: { txId: string; ref: string | null; actorId?: string; itemId: string; productId: string; desired: number; deducted: number; warehouseId: string | null },
  ) {
    const owedRow = await db.stockOwed.findFirst({
      where: { salesTransactionId: a.txId, productId: a.productId, status: 'open', deletedAt: null },
    });
    const owed = owedRow?.quantity ?? 0;
    const committed = a.deducted + owed;

    if (a.desired > committed) {
      // Need more off the shelf. Take what stock allows; the rest becomes owed.
      let need = a.desired - committed;
      const wh = await this.pickDeductionWarehouse(db, a.productId, a.warehouseId);
      const level = wh
        ? await db.stockLevel.findUnique({ where: { productId_warehouseId: { productId: a.productId, warehouseId: wh } }, select: { quantityOnHand: true } })
        : null;
      const take = Math.min(Math.max(0, level?.quantityOnHand ?? 0), need);
      if (take > 0 && wh) {
        await this.stock.applyDeltaWithin(db, { productId: a.productId, warehouseId: wh, qtyDelta: -take, reason: 'sale', reference: a.ref, actorId: a.actorId });
        await db.salesTransactionItem.update({ where: { id: a.itemId }, data: { stockDeductedQty: a.deducted + take, stockWarehouseId: wh } });
        need -= take;
      }
      if (need > 0) {
        if (owedRow) await db.stockOwed.update({ where: { id: owedRow.id }, data: { quantity: owed + need } });
        else await db.stockOwed.create({
          data: { productId: a.productId, warehouseId: wh, salesTransactionId: a.txId, transactionRef: a.ref, quantity: need, status: 'open', reason: 'sold_before_receipt', openedById: a.actorId ?? null },
        });
      }
    } else if (a.desired < committed) {
      // Give some back. Owed units never left stock, so cancel those first; only then restock
      // what was physically taken.
      let release = committed - a.desired;
      if (owedRow && owed > 0) {
        const reduce = Math.min(owed, release);
        const remaining = owed - reduce;
        await db.stockOwed.update({
          where: { id: owedRow.id },
          data: remaining > 0 ? { quantity: remaining } : { quantity: 0, status: 'cancelled', deletedAt: new Date() },
        });
        release -= reduce;
      }
      if (release > 0 && a.warehouseId) {
        await this.stock.applyDeltaWithin(db, { productId: a.productId, warehouseId: a.warehouseId, qtyDelta: release, reason: 'sale_reversal', reference: a.ref, actorId: a.actorId });
        await db.salesTransactionItem.update({ where: { id: a.itemId }, data: { stockDeductedQty: a.deducted - release } });
      }
    }
  }

  /** Where an ordinary sale takes stock from: the line's existing warehouse if it already has
   *  one, else the sellable warehouse holding the most of this product, else — when nothing is
   *  in stock — the first sellable warehouse, so an owed row still has a home. */
  private async pickDeductionWarehouse(db: Prisma.TransactionClient, productId: string, preferred: string | null): Promise<string | null> {
    if (preferred) return preferred;
    const level = await db.stockLevel.findFirst({
      where: { productId, quantityOnHand: { gt: 0 }, warehouse: { deletedAt: null, isActive: true, includeInInventory: true } },
      orderBy: { quantityOnHand: 'desc' },
      select: { warehouseId: true },
    });
    if (level) return level.warehouseId;
    const wh = await db.warehouse.findFirst({
      where: { deletedAt: null, isActive: true, includeInInventory: true },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    return wh?.id ?? null;
  }

  /** A submitted transaction is locked: only admins edit it, unless it's been unlocked. */
  private assertCanEdit(existing: { status: string; unlockedForEdit: boolean }, user: AuthUser) {
    const editable = user.isAdmin || existing.status === 'draft' || existing.unlockedForEdit;
    if (!editable) {
      throw new ForbiddenException('This transaction is submitted and locked. Request an unlock from an admin.');
    }
  }

  async update(id: string, dto: UpdateSalesTransactionDto, user: AuthUser, companyIds?: string[]) {
    const existing = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) }, include: { items: { where: { deletedAt: null } } } });
    if (!existing) throw new NotFoundException('Sales transaction not found');
    this.assertCanEdit(existing, user);

    const channelId = dto.salesChannelId === undefined ? existing.salesChannelId : dto.salesChannelId;
    const { channel, currency, feeCurrency } = await this.channelInfo(channelId);
    const isLocal = channel?.kind === 'local';
    const nextStatus = dto.status ?? existing.status;
    // Submitting re-locks it (unless the actor is an admin, who always retains access).
    const unlockedForEdit = nextStatus === 'submitted' ? false : existing.unlockedForEdit;
    const txDate = dto.date ?? existing.date.toISOString();
    const exchangeRate = isLocal ? 1 : await this.rateForChannel(channel, currency, txDate);
    const feeExchangeRate = isLocal
      ? 1
      : feeCurrency && feeCurrency !== currency ? await this.rateForChannel(channel, feeCurrency, txDate) : exchangeRate;
    const destCountryId = dto.destinationCountryId === undefined ? existing.destinationCountryId : dto.destinationCountryId;
    const resolvedServiceId = isLocal ? null : await this.resolveShippingService(dto.shippingServiceId, destCountryId);
    // Intrinsic (ex-VAT, goods-only) value for the marketplace VAT threshold — net sales, no VAT, no shipping.
    const overall = (dto.items ?? existing.items).reduce((s: number, i: any) => s + n(i.netSalesAmount), 0);
    const { pct: destinationVatPct, overridden: vatOverridden } = isLocal
      ? { pct: null, overridden: false }
      : await this.resolveDestinationVat(dto, channel, overall, destCountryId);
    const taxType = isLocal ? 'vat' : await this.resolveTaxType(destCountryId);
    // An omitted discount field means "leave as it was", not "clear it".
    const discountType = dto.discountType === undefined ? existing.discountType : dto.discountType;
    const discountValue = dto.discountValue === undefined ? existing.discountValue : dto.discountValue;
    const discountBase = dto.discountBase === undefined ? (existing.discountBase ?? 'net') : dto.discountBase;
    // Save-time review: re-link lines to the current catalogue, then (local) recompute VAT.
    const linked = dto.items ? await this.linkItemsToCatalogue(dto.items) : undefined;
    const items = linked && isLocal
      ? await this.resolveLocalVat(linked, { type: discountType, value: discountValue, base: discountBase })
      : linked;

    // Submitting is the moment the units are committed, so that is where serials are
    // demanded. Re-submitting an already-submitted transaction must not consume twice,
    // so anything this transaction already holds is released first.
    const serialItems = (dto.items ?? existing.items).map((i: any, idx: number) => ({
      productId: (linked?.[idx]?.productId ?? i.productId) ?? null,
      sku: i.sku,
      quantity: i.quantity,
      serials: (dto.items?.[idx] as any)?.serials,
    }));
    const serialWork = await this.resolveSerialConsumption(serialItems, nextStatus);

    // Replacing the item rows drops their stockDeductedQty tracking, so return whatever the
    // current items hold first; the post-update reconcile then deducts against the new lines.
    // (No-op when the feature is off or nothing was deducted.)
    if (items) {
      await this.reconcileSaleStock(id, user.sub, { forceRelease: true });
      await this.reconcileSaleAvailability(id, user.sub, { forceRelease: true }); // return old lines' Availability before they're replaced
    }

    await this.prisma.$transaction(async (tx) => {
      if (serialWork.length) {
        await this.serials.restockWithin(tx, { salesTransactionId: id });
      }
      if (items) {
        // Lines are replaced wholesale on edit, so carry the frozen costs over first — re-saving
        // a sale must not re-cost it at today's prices.
        const existing = await tx.salesTransactionItem.findMany({
          where: { transactionId: id },
          select: { sku: true, unitCostSnapshotEur: true, costSnapshotSource: true, costSnapshotAt: true },
        });
        const keep = new Map<string, { eur: number; source: string; at: Date }>();
        for (const e of existing) {
          if (e.unitCostSnapshotEur == null) continue;
          keep.set(String(e.sku ?? '').trim().toLowerCase(), {
            eur: Number(e.unitCostSnapshotEur),
            source: e.costSnapshotSource ?? 'catalogue',
            at: e.costSnapshotAt ?? new Date(),
          });
        }
        const frozen = await this.freezeUnitCosts(items, keep);
        await tx.salesTransactionItem.deleteMany({ where: { transactionId: id } });
        await tx.salesTransactionItem.createMany({
          data: frozen.map((i) => ({ ...i, transactionId: id, productId: i.productId ?? null })),
        });
      }
      await tx.salesTransaction.update({
        where: { id },
        data: {
          date: dto.date ? new Date(dto.date) : undefined,
          transactionRef: dto.transactionRef,
          salesChannelId: dto.salesChannelId,
          destinationCountryId: dto.destinationCountryId,
          shippingServiceId: resolvedServiceId,
          currency: isLocal ? 'EUR' : currency,
          feeCurrency: isLocal ? 'EUR' : feeCurrency,
          exchangeRate,
          feeExchangeRate,
          destinationVatPct,
          vatOverridden,
          taxType,
          deliveryMethod: isLocal ? dto.deliveryMethod ?? undefined : null,
          localShippingCostEur: isLocal ? dto.localShippingCostEur ?? undefined : null,
          discountType: isLocal ? discountType : null,
          discountValue: isLocal ? discountValue : null,
          discountBase: isLocal ? discountBase : null,
          status: nextStatus,
          fulfilmentStatus: dto.fulfilmentStatus,
          channelShipmentStatus: dto.channelShipmentStatus,
          fulfilmentType: dto.fulfilmentType,
          unlockedForEdit,
          updatedById: user.sub,
        },
      });
    });

    await this.consumeSerials(serialWork, id, existing.transactionRef, user.sub);
    await this.reconcileSaleStock(id, user.sub);
    await this.applyAvailabilitySellThrough(id, user.sub);
    return this.get(id);
  }

  /** Bulk set status (draft/submitted) on many transactions. Skips ones the user
   *  can't edit (submitted + locked for non-admins). */
  async bulkStatus(ids: string[], status: 'draft' | 'submitted', user: AuthUser) {
    const rows = await this.prisma.salesTransaction.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, status: true, unlockedForEdit: true },
    });
    let updated = 0;
    let skipped = 0;
    for (const r of rows) {
      const editable = user.isAdmin || r.status === 'draft' || r.unlockedForEdit;
      if (!editable) { skipped++; continue; }
      // Submitting re-locks for non-admins; moving to draft clears the unlock flag.
      await this.prisma.salesTransaction.update({
        where: { id: r.id },
        data: { status, unlockedForEdit: false, updatedById: user.sub },
      });
      // Move stock to match the new status: submitting deducts, reverting to draft returns it.
      await this.reconcileSaleStock(r.id, user.sub);
      await this.applyAvailabilitySellThrough(r.id, user.sub);
      updated++;
    }
    return { updated, skipped };
  }

  /** Re-derive every transaction's stored snapshots from the CURRENT configuration so a
   *  later change to a product, sales channel, destination country, shipping service, VAT
   *  rule or FX flows through to the calculated figures. Re-resolves per line:
   *   • product link (SKU → product/alias, case-insensitive)
   *  and per transaction:
   *   • sales-channel currency / fee currency
   *   • FX + fee FX (re-fetched only when the currency changed or the rate was missing —
   *     historical rates are immutable, so we don't re-hit the FX API needlessly)
   *   • shipping service (keeps an explicit choice, else the destination country's default)
   *   • destination VAT % (keeps a manual override, else the channel rule / country rate)
   *  Revenue, profit, shipping cost, weight, FBA cost etc. are computed on read, so they
   *  recompute automatically once the snapshots above are refreshed. Only rows that actually
   *  changed are written. */
  /** Re-derive stored header/link fields from the current catalogue and settings. With no
   *  `ids`, sweeps every transaction; pass a set of ids to recalculate just those — far faster
   *  when you know exactly which orders you changed. */
  async recalculate(ids?: string[]) {
    // Explicit "refresh against current settings" — never serve a stale service/fee/FX lookup.
    this.invalidateLookupCache();
    const scoped = Array.isArray(ids) && ids.length > 0;
    const txs = await this.prisma.salesTransaction.findMany({
      where: { deletedAt: null, ...(scoped ? { id: { in: ids } } : {}) },
      include: { items: { where: { deletedAt: null }, select: { id: true, sku: true, productId: true, netSalesAmount: true, vatAmount: true, vatClassId: true, shippingAmount: true, shippingAmountVat: true } } },
    });

    // SKU (lowercased) → productId from the current catalogue (main SKU wins over alias).
    // When recalculating a known set of orders, resolve only their SKUs / products instead
    // of loading the whole catalogue (a full sweep still needs everything).
    const skuToProduct = await this.buildSkuToProduct(
      scoped ? txs.flatMap((t) => t.items.map((i) => i.sku)) : undefined,
    );
    // productId → its current VAT class, used to fill in local lines that never got one
    // (e.g. imported before the product existed).
    const scopedPids = new Set<string>();
    if (scoped) {
      for (const t of txs) for (const it of t.items) if (it.productId) scopedPids.add(it.productId);
      for (const pid of skuToProduct.values()) scopedPids.add(pid);
    }
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, ...(scoped ? { id: { in: [...scopedPids] } } : {}) },
      select: { id: true, vatClassId: true, vatClass: { select: { ratePct: true } } },
    });
    const vatByProduct = new Map<string, { vatClassId: string; ratePct: number }>();
    for (const p of products) {
      if (p.vatClassId && p.vatClass) vatByProduct.set(p.id, { vatClassId: p.vatClassId, ratePct: Number(p.vatClass.ratePct) });
    }

    // FX cache — one lookup per (currency, date) across the whole run.
    // Keyed by channel as well as currency and date: a channel carrying its own rate must not be
    // handed another channel's cached market rate for the same currency.
    const fxCache = new Map<string, number | null>();
    const fx = async (currency: string | null, date: string, channel?: any): Promise<number | null> => {
      if (!currency) return null;
      const key = `${channel?.id ?? '-'}:${currency.toUpperCase()}:${date.slice(0, 10)}`;
      if (!fxCache.has(key)) fxCache.set(key, await this.rateForChannel(channel, currency, date));
      return fxCache.get(key) ?? null;
    };
    const same = (a: number | null | undefined, b: number | null | undefined) =>
      (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-9);

    let checked = 0;
    let updated = 0;
    let relinkedItems = 0;
    let vattedItems = 0;
    for (const t of txs) {
      checked++;
      const dateIso = t.date.toISOString();
      const { channel, currency, feeCurrency } = await this.channelInfo(t.salesChannelId);
      // Historical FX is immutable — re-fetched only when the currency changed or was never set.
      //
      // A channel with its own conversion spread is the exception, and it is a correction rather
      // than a restatement: the stored rate was never the rate that money converted at. eBay
      // settled the order roughly 3% below market, so the recorded rate describes a conversion
      // that did not happen. Recomputing makes the transaction true.
      //
      // Safe to repeat: the rate is derived from the market rate for the transaction's own date
      // and discounted once, never from the stored rate, so running this twice cannot compound.
      const hasSpread = channel?.fxSpreadPct != null && Number(channel.fxSpreadPct) > 0;
      let exchangeRate = t.exchangeRate;
      if (currency !== t.currency || exchangeRate == null || hasSpread) exchangeRate = await fx(currency, dateIso, channel);
      let feeExchangeRate = t.feeExchangeRate;
      if (feeCurrency !== t.feeCurrency || feeExchangeRate == null || hasSpread) {
        feeExchangeRate = feeCurrency && feeCurrency !== currency ? await fx(feeCurrency, dateIso, channel) : exchangeRate;
      }
      // Imported orders never carry a manual service pick, so always re-derive theirs from the
      // destination country's CURRENT default (a default change then propagates). Manual orders
      // keep an explicitly-chosen service, else fall back to the country default.
      // A local sale has no carrier at all, so it must never acquire a shipping service.
      const isLocal = channel?.kind === 'local';
      const shippingServiceId = isLocal
        ? null
        : t.source && t.source !== 'manual'
          ? await this.resolveShippingService(null, t.destinationCountryId)
          : await this.resolveShippingService(t.shippingServiceId, t.destinationCountryId);
      // Intrinsic (ex-VAT, goods-only) value for the marketplace VAT threshold — net sales, no VAT, no shipping.
      const overall = t.items.reduce((s: number, i: any) => s + n(i.netSalesAmount), 0);
      const { pct: destinationVatPct, overridden: vatOverridden } =
        await this.resolveDestinationVat({ vatOverridden: t.vatOverridden, destinationVatPct: t.destinationVatPct }, channel, overall, t.destinationCountryId);

      const itemUpdates = t.items
        .map((it) => ({ id: it.id, current: it.productId ?? null, next: skuToProduct.get((it.sku ?? '').trim().toLowerCase()) ?? null }))
        .filter((u) => u.next != null && u.next !== u.current); // additive only — never clear a link

      // Local lines that never got a VAT class (imported before the product existed) pick one up
      // once the SKU resolves. Only ever fills a blank — an explicit class is never overwritten.
      const vatUpdates: { id: string; vatClassId: string; vatRatePct: number; vatAmount: number }[] = [];
      if (isLocal) {
        for (const it of t.items) {
          if (it.vatClassId != null) continue;
          const productId = skuToProduct.get((it.sku ?? '').trim().toLowerCase()) ?? it.productId ?? null;
          const vc = productId ? vatByProduct.get(productId) : null;
          if (!vc) continue;
          vatUpdates.push({
            id: it.id,
            vatClassId: vc.vatClassId,
            vatRatePct: vc.ratePct,
            vatAmount: round(n(it.netSalesAmount) * (vc.ratePct / 100), 2),
          });
        }
      }

      const headerChanged =
        (currency ?? null) !== (t.currency ?? null) ||
        (feeCurrency ?? null) !== (t.feeCurrency ?? null) ||
        !same(exchangeRate, t.exchangeRate) || !same(feeExchangeRate, t.feeExchangeRate) ||
        (shippingServiceId ?? null) !== (t.shippingServiceId ?? null) ||
        !same(destinationVatPct, t.destinationVatPct) || vatOverridden !== t.vatOverridden;

      if (!headerChanged && itemUpdates.length === 0 && vatUpdates.length === 0) continue;
      await this.prisma.$transaction([
        this.prisma.salesTransaction.update({
          where: { id: t.id },
          data: { currency, feeCurrency, exchangeRate, feeExchangeRate, shippingServiceId, destinationVatPct, vatOverridden },
        }),
        ...itemUpdates.map((u) => this.prisma.salesTransactionItem.update({ where: { id: u.id }, data: { productId: u.next } })),
        ...vatUpdates.map((u) => this.prisma.salesTransactionItem.update({
          where: { id: u.id },
          data: { vatClassId: u.vatClassId, vatRatePct: u.vatRatePct, vatAmount: u.vatAmount },
        })),
      ]);
      relinkedItems += itemUpdates.length;
      vattedItems += vatUpdates.length;
      updated++;
    }
    return { checked, updated, relinkedItems, vattedItems };
  }

  /** Apply an order resolution (return / cancellation / refund). Cancelling also
   *  moves the transaction out of the fulfilment worklist. */
  async resolve(
    id: string,
    dto: { resolution: string; refundAmount?: number | null; restockItems?: boolean; feeRefunded?: boolean; resolutionNotes?: string | null; returnedToStock?: boolean; returnWarehouseId?: string | null },
    user: AuthUser,
    companyIds?: string[],
  ) {
    const existing = await this.prisma.salesTransaction.findFirst({
      where: { id, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, status: true, unlockedForEdit: true, fulfilmentStatus: true, fulfilmentType: true, resolution: true, cancelStage: true, returnWarehouseId: true, transactionRef: true },
    });
    if (!existing) throw new NotFoundException('Sales transaction not found');
    this.assertCanEdit(existing, user);
    // An order cancelled before it was ever placed took no payment and shipped nothing, so there
    // is no refund to record, nothing to restock and no return decision to make. The UI hides the
    // control; this refuses the request, because a hidden button is not a rule.
    if (existing.cancelStage === 'pending') {
      throw new BadRequestException(
        'This order was cancelled while still pending, so it never became an order — no payment was taken and nothing shipped. There is nothing to resolve.',
      );
    }
    const clearing = dto.resolution === 'none';
    const isFba = existing.fulfilmentType === 'FBA';

    // Decide, from the return decision, where (if anywhere) the goods go back and whether that
    // reverses the product cost:
    //  - FBM: the goods come back to us. The operator picks a warehouse; a warehouse that counts
    //    as sellable inventory means the unit is resellable → reverse COGS. A "used/not-sellable"
    //    virtual warehouse still tracks the unit but keeps the cost as a loss.
    //  - FBA: the goods go back to Amazon, never to us — no local warehouse, no stock movement.
    //    "Returned & resellable" is Amazon's call, taken here as a plain flag → reverse COGS.
    let newReturnWarehouseId: string | null = null;
    let restockItems = false;
    if (!clearing && (dto.returnedToStock || dto.returnWarehouseId)) {
      if (isFba) {
        restockItems = true; // Amazon re-listed it
      } else {
        if (!dto.returnWarehouseId) throw new BadRequestException('Choose the warehouse the returned goods go into');
        const wh = await this.prisma.warehouse.findFirst({ where: { id: dto.returnWarehouseId, deletedAt: null }, select: { id: true, includeInInventory: true } });
        if (!wh) throw new NotFoundException('Return warehouse not found');
        newReturnWarehouseId = wh.id;
        restockItems = wh.includeInInventory; // sellable location → resellable → reverse COGS
      }
    } else if (!clearing && dto.restockItems != null) {
      // Legacy path (no warehouse): honour an explicit restock flag.
      restockItems = !!dto.restockItems;
    }

    await this.prisma.salesTransaction.update({
      where: { id },
      data: {
        resolution: dto.resolution,
        // The stage belongs to a cancellation and only to a cancellation. Changing a cancelled
        // order to 'returned' while leaving the stage behind violates the database CHECK and
        // fails the whole update — so it is cleared here rather than discovered in production.
        cancelStage: dto.resolution === 'cancelled' ? undefined : null,
        refundAmount: clearing ? null : dto.refundAmount ?? null,
        restockItems: clearing ? false : restockItems,
        feeRefunded: clearing ? false : !!dto.feeRefunded,
        resolutionNotes: clearing ? null : dto.resolutionNotes ?? null,
        resolvedAt: clearing ? null : new Date(),
        returnWarehouseId: newReturnWarehouseId,
        returnHandled: !clearing, // resolving IS making the decision
        resolutionSource: clearing ? null : 'manual',
        // Cancelling removes it from the pending worklist; clearing a cancel restores pending.
        ...(dto.resolution === 'cancelled' ? { fulfilmentStatus: 'cancelled' } : {}),
        ...(clearing && existing.fulfilmentStatus === 'cancelled' ? { fulfilmentStatus: 'pending' } : {}),
        updatedById: user.sub,
      },
    });

    // Physical stock, FBM only. Move the returned-goods restock to its new state (reverse the
    // previous return warehouse, add the new one) — a no-op when nothing changed.
    if (existing.returnWarehouseId !== newReturnWarehouseId) {
      await this.prisma.$transaction((db) =>
        this.applyReturnRestock(db, { txId: id, ref: existing.transactionRef, actorId: user.sub, oldWarehouseId: existing.returnWarehouseId, newWarehouseId: newReturnWarehouseId }),
      );
    }
    // Cancelling releases any stock the submit had reserved; clearing a cancel re-reserves it.
    // reconcileSaleStock reads the resolution we just wrote.
    if (dto.resolution === 'cancelled' || (clearing && existing.resolution === 'cancelled')) {
      await this.reconcileSaleStock(id, user.sub);
      await this.applyAvailabilitySellThrough(id, user.sub); // cancelling gives Availability back; clearing re-takes it
    }
    return this.get(id);
  }

  /**
   * Move a returned FBM order's goods between "return warehouses". A customer return is a fresh
   * inflow to the chosen warehouse (not a reversal of the original sale deduction — the sold
   * unit genuinely left), so it is booked as its own movement. Changing or clearing the choice
   * reverses the previous warehouse first. Serial-tracked lines are left to the serial register.
   */
  private async applyReturnRestock(
    db: Prisma.TransactionClient,
    a: { txId: string; ref: string | null; actorId?: string; oldWarehouseId: string | null; newWarehouseId: string | null },
  ) {
    if (a.oldWarehouseId === a.newWarehouseId) return;
    const items = await db.salesTransactionItem.findMany({
      where: { transactionId: a.txId, deletedAt: null, productId: { not: null } },
      select: { sku: true, productId: true, quantity: true, product: { select: { serialTracked: true } } },
    });
    for (const it of items) {
      if (!it.productId || it.product?.serialTracked) continue;
      if (a.oldWarehouseId) {
        await this.stock.applyDeltaWithin(db, { productId: it.productId, warehouseId: a.oldWarehouseId, qtyDelta: -this.wholeUnitsForStock(it.quantity, it.sku, 'stock'), reason: 'customer_return_reversed', reference: a.ref, actorId: a.actorId });
      }
      if (a.newWarehouseId) {
        await this.stock.applyDeltaWithin(db, { productId: it.productId, warehouseId: a.newWarehouseId, qtyDelta: this.wholeUnitsForStock(it.quantity, it.sku, 'stock'), reason: 'customer_return', reference: a.ref, actorId: a.actorId });
      }
    }
  }

  /**
   * Apply a resolution the CHANNEL told us about (an Amazon cancellation or refund), rather than
   * one the operator entered. System-driven, so it bypasses the edit-lock — but it never
   * overwrites a decision the operator already made by hand, and it is idempotent: re-running a
   * sync with the same figures changes nothing.
   *
   *  - cancelled: Amazon only cancels pre-ship → financially neutral. Releases any reserved
   *    stock and closes it out (returnHandled true — nothing for the operator to decide).
   *  - returned  (a refund on a shipped order): revenue is reversed by the refund and the costs
   *    stay. The physical-return decision (did it come back, to which warehouse, who paid return
   *    shipping) is the operator's, so it lands as a pending item (returnHandled false).
   */
  async applyChannelResolution(
    txId: string,
    args: {
      resolution: 'cancelled' | 'returned';
      refundAmount?: number | null;
      feeRefunded?: boolean;
      /** For a cancellation, whether the order was ever confirmed. See ChannelListing.cancelStage. */
      cancelStage?: 'pending' | 'placed' | null;
    },
    actorId?: string,
  ): Promise<{ applied: boolean; reason?: string }> {
    const existing = await this.prisma.salesTransaction.findFirst({
      where: { id: txId, deletedAt: null },
      select: { id: true, resolution: true, resolutionSource: true, refundAmount: true, feeRefunded: true, cancelStage: true },
    });
    if (!existing) return { applied: false, reason: 'not_found' };
    // Never clobber a decision the operator made in the app.
    if (existing.resolutionSource === 'manual') return { applied: false, reason: 'manual' };
    // Nothing new to write — same resolution, same refund, same fee state.
    const sameRefund = args.refundAmount == null || Math.abs(Number(existing.refundAmount ?? 0) - Number(args.refundAmount)) < 0.005;
    // A stage we do not have yet is new information, even when everything else matches. Without
    // this, every row cancelled before the column existed would answer "unchanged" forever and
    // never learn which kind of cancellation it was.
    const sameStage = args.cancelStage == null || existing.cancelStage === args.cancelStage;
    if (existing.resolution === args.resolution && sameRefund && sameStage && (args.resolution !== 'returned' || existing.feeRefunded === !!args.feeRefunded)) {
      return { applied: false, reason: 'unchanged' };
    }

    const isCancel = args.resolution === 'cancelled';
    await this.prisma.salesTransaction.update({
      where: { id: txId },
      data: {
        resolution: args.resolution,
        refundAmount: args.refundAmount ?? null,
        feeRefunded: !!args.feeRefunded,
        // The physical return is the operator's later call — auto-ingest never restocks.
        restockItems: false,
        returnWarehouseId: null,
        returnHandled: isCancel, // cancel is neutral & done; a refund needs a return decision
        resolutionSource: 'amazon',
        resolvedAt: new Date(),
        // Only a cancellation carries a stage; anything else clears it (the CHECK constraint
        // in the database enforces the same rule, so a bug here fails loudly rather than rots).
        cancelStage: isCancel ? args.cancelStage ?? null : null,
        ...(isCancel ? { fulfilmentStatus: 'cancelled' } : {}),
        updatedById: actorId ?? null,
      },
    });
    // Cancelling releases any stock the submit reserved (FBA is a no-op; reconcile reads the
    // resolution we just wrote).
    if (isCancel) {
      await this.reconcileSaleStock(txId, actorId);
      await this.applyAvailabilitySellThrough(txId, actorId); // give Availability back and push the new figure
    }
    return { applied: true };
  }

  async remove(id: string, user: AuthUser, companyIds?: string[]) {
    const existing = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) } });
    if (!existing) throw new NotFoundException('Sales transaction not found');
    this.assertCanEdit(existing, user);
    // Return any stock this sale had taken (and cancel its owed rows) before it disappears.
    await this.reconcileSaleStock(id, user.sub, { forceRelease: true });
    await this.applyAvailabilitySellThrough(id, user.sub, { forceRelease: true }); // and any Availability it consumed
    await this.prisma.salesTransaction.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  // --- Unlock requests -----------------------------------------------------
  async requestUnlock(id: string, userId: string) {
    const t = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw new NotFoundException('Sales transaction not found');
    if (t.status !== 'submitted' || t.unlockedForEdit) {
      throw new BadRequestException('This transaction is not locked.');
    }
    const existing = await this.prisma.salesTransactionUnlockRequest.findFirst({ where: { transactionId: id, status: 'pending' } });
    if (existing) return { ok: true, alreadyRequested: true };
    await this.prisma.salesTransactionUnlockRequest.create({ data: { transactionId: id, requestedById: userId } });
    return { ok: true };
  }

  async listUnlockRequests() {
    const reqs = await this.prisma.salesTransactionUnlockRequest.findMany({
      where: { status: 'pending' },
      include: { transaction: { select: { id: true, transactionRef: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const userIds = [...new Set(reqs.map((r) => r.requestedById).filter(Boolean) as string[])];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u.fullName]));
    return reqs.map((r) => ({
      id: r.id,
      transactionId: r.transactionId,
      transactionRef: r.transaction.transactionRef,
      requestedBy: r.requestedById ? byId.get(r.requestedById) ?? '—' : '—',
      createdAt: r.createdAt,
    }));
  }

  async decideUnlock(requestId: string, grant: boolean, adminId: string) {
    const req = await this.prisma.salesTransactionUnlockRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Unlock request not found');
    await this.prisma.$transaction([
      this.prisma.salesTransactionUnlockRequest.update({
        where: { id: requestId },
        data: { status: grant ? 'granted' : 'denied', decidedById: adminId, decidedAt: new Date() },
      }),
      ...(grant
        ? [this.prisma.salesTransaction.update({ where: { id: req.transactionId }, data: { unlockedForEdit: true } })]
        : []),
    ]);
    return { ok: true };
  }
}
