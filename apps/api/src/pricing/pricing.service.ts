import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingFxService } from './fx.service';
import { BulkPricingDto, IndividualPricingDto } from './dto/pricing.dto';

const ACTIVE = { deletedAt: null };
const round = (v: number, dp = 2) => Number(v.toFixed(dp));
/** The platform's volumetric divisor, matching the sales-transaction shipping estimate. */
const VOLUMETRIC_DIVISOR = 5000;

/** Display labels per tax regime, matching the sales-transaction module. */
const TAX_LABELS: Record<string, string> = { vat: 'VAT', gst: 'GST', jct: 'Japanese Consumption Tax', sales_tax: 'Sales tax', none: 'Tax' };
const taxLabelFor = (t: string) => TAX_LABELS[t] ?? 'Tax';

/**
 * Effective marketplace tax/reward rates for the tax-on-top Amazon markets, expressed as a
 * percentage of the **net** (item) price so they slot straight into the net-based economics.
 * These are empirical rates measured across the platform's own settled orders, not statutory
 * headline rates — Amazon JP lists tax-inclusive at the reduced band, so the consumption tax
 * lands at ~7.41% of net (≈6.9% of the buyer-paid total) rather than the 10% standard rate.
 *   JP consumption tax : 7.41% of net  (verified across all registered Amazon JPN orders)
 *   JP Amazon Points   : 1.00% of net  (reward deducted from our proceeds; ≈0.93% of total)
 *   AU GST             : 10.0% of net  (≈9.09% of the buyer-paid total)
 */
const JCT_RATE_PCT = 7.41;
const AMAZON_POINTS_PCT = 1.0;
const GST_RATE_PCT = 10;

/** Everything a single price calculation needs, resolved once and reused. */
export interface CostInputs {
  costEur: number;
  /** FBM: outbound shipping to the buyer. FBA: allocated inbound cost of getting the unit to Amazon. */
  shippingEur: number;
  /** Amazon's per-unit FBA fulfilment fee. 0 for FBM. Kept separate from shipping so the
   *  breakdown can show what is our freight and what is Amazon's charge. */
  fbaFeeEur?: number;
  importPct: number;
  feePct: number;
  vatPct: number;
  /** Amazon Points reward (JP), % of net — a deduction from proceeds. 0 elsewhere. */
  pointsPct: number;
  /** Destination tax regime, for labelling the tax line. */
  taxType: string;
}

/**
 * What a listing cell was costed with, alongside the result. The inputs matter as much as the
 * answer: Individual Pricing can override cost/shipping/fee/VAT, so a disagreement between the two
 * screens is an input difference, not different maths — both call the same economics().
 */
export interface ListingEconomics {
  profitEur: number | null;
  marginPct: number | null;
  loss: boolean;
  priceEur?: number;
  costEur?: number;
  shippingEur?: number;
  feeEur?: number;
  vatEur?: number;
  feePct?: number;
  vatPct?: number;
  shippingServiceName?: string | null;
}

/** Tax the channel applies to a listing, and whether our listed price already contains it. */
export interface ChannelTax {
  taxType: string;
  vatPct: number;
  pointsPct: number;
  /** false ⇒ the marketplace adds the tax on top at checkout, so the listed price is our revenue. */
  priceIncludesTax: boolean;
  /** The tax the buyer pays when the channel adds it on top; 0 when it is already in our price. */
  collectedByChannelPct: number;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: PricingFxService,
  ) {}

  // ---------------------------------------------------------------- shared maths

  /**
   * Profit for a listing price, in EUR.
   *
   * Mirrors how the sales-transaction module values a sale, including its deliberate
   * asymmetry: profit is net of VAT, but margin is measured against the VAT-inclusive
   * amount the buyer pays. Keeping that identical means a price set here and a sale
   * booked later report the same margin.
   */
  private economics(grossEur: number, c: CostInputs) {
    const netEur = grossEur / (1 + c.vatPct / 100);
    const vatEur = grossEur - netEur;
    const feeEur = grossEur * (c.feePct / 100);
    const importEur = c.costEur * (c.importPct / 100);
    // Amazon Points (JP) are a reward funded from our proceeds — a real cost, keyed off net.
    const pointsEur = netEur * (c.pointsPct / 100);
    const fbaFeeEur = c.fbaFeeEur ?? 0;
    const profit = netEur - feeEur - c.costEur - c.shippingEur - importEur - pointsEur - fbaFeeEur;
    return {
      netEur: round(netEur),
      vatEur: round(vatEur),
      feeEur: round(feeEur),
      importEur: round(importEur),
      pointsEur: round(pointsEur),
      taxType: c.taxType,
      taxLabel: taxLabelFor(c.taxType),
      costEur: round(c.costEur),
      shippingEur: round(c.shippingEur),
      fbaFeeEur: round(fbaFeeEur),
      profitEur: round(profit),
      // Margin against what the buyer pays, matching the transaction module's base.
      marginPct: grossEur > 0 ? round((profit / grossEur) * 100) : 0,
    };
  }

  /**
   * The listing price that hits a target margin.
   *
   * Solving profit = target × gross for gross gives
   *   gross × (1/(1+vat) − fee − target) = cost + shipping + import
   * A denominator at or below zero means tax and fees already consume the whole price:
   * no price achieves that margin, so the channel is reported as unreachable rather
   * than quoting a misleading number.
   */
  private solveGrossEur(target: number, c: CostInputs): number | null {
    // Net is (1 − points%) usable after the Amazon Points reward is funded from it.
    const denom = (1 - c.pointsPct / 100) / (1 + c.vatPct / 100) - c.feePct / 100 - target / 100;
    if (denom <= 0) return null;
    const costs = c.costEur + c.shippingEur + (c.fbaFeeEur ?? 0) + c.costEur * (c.importPct / 100);
    const gross = costs / denom;
    return gross > 0 && Number.isFinite(gross) ? gross : null;
  }

  /**
   * Tax regime for a channel, from its native country. The tax-on-top Amazon markets carry
   * effective rates verified from settled orders (JP consumption tax + Amazon Points, AU GST);
   * everywhere else keeps the destination VAT rate and its consignment-threshold rule.
   */
  private resolveTax(channel: any, value: number, valueIsNet = false): ChannelTax {
    const iso = channel?.nativeCountry?.isoCode ?? null;
    const base = ((): { taxType: string; vatPct: number; pointsPct: number } => {
      if (iso === 'JP') return { taxType: 'jct', vatPct: JCT_RATE_PCT, pointsPct: AMAZON_POINTS_PCT };
      if (iso === 'AU') return { taxType: 'gst', vatPct: GST_RATE_PCT, pointsPct: 0 };
      const countryVat = channel?.nativeCountry?.vatRate != null ? Number(channel.nativeCountry.vatRate) : null;
      return { taxType: 'vat', vatPct: this.channelVatPct(channel, value, countryVat, valueIsNet), pointsPct: 0 };
    })();

    // Two independent facts decide whether the destination tax comes off our revenue, and the
    // sales-transaction module already distinguishes them — pricing must match it or the same
    // listing reports one profit as a forecast and another as a sale.
    //
    //   • Is the tax inside the price we list?  EU: yes. AU/US/CA/MX: no, added at checkout.
    //   • Is the tax ours to keep?              Japan: yes — Amazon pays out the full
    //     tax-inclusive amount and does not remit the JCT. Everywhere else: no.
    //
    // Revenue loses the tax only when the price contains it AND we have to hand it over.
    const sellerKeepsTax = base.taxType === 'jct';
    const priceIncludesTax = channel?.pricesIncludeTax !== false;
    if (!priceIncludesTax || sellerKeepsTax) {
      return { ...base, vatPct: 0, priceIncludesTax, collectedByChannelPct: base.vatPct };
    }
    return { ...base, priceIncludesTax, collectedByChannelPct: 0 };
  }

  /**
   * VAT the channel applies, as a percentage.
   *
   * Marketplaces with a consignment threshold (the UK's £135 is the archetype) collect
   * VAT at the point of sale at or below it, and leave import VAT to the border above it.
   *
   * HMRC measures that threshold on the consignment's **intrinsic value** — "the price
   * the goods were sold for, not including … other identifiable taxes and charges" —
   * so the comparison is against the price EXCLUDING VAT, not the price the buyer pays.
   * At 20% that puts the switchover at a £162.00 gross ticket: £162.00 is £135.00 net and
   * still inside the threshold, £162.01 is outside it.
   *
   * `value` is in the channel's own currency. Pass the gross (buyer-paid) figure and this
   * derives the net itself, or pass a net figure with `valueIsNet`.
   */
  private channelVatPct(channel: any, value: number, countryVat: number | null, valueIsNet = false): number {
    if (channel?.vatThresholdEnabled && channel.vatThresholdAmount != null) {
      const below = channel.vatBelowThresholdPct != null ? Number(channel.vatBelowThresholdPct) : 0;
      const netValue = valueIsNet ? value : value / (1 + below / 100);
      const pct =
        netValue <= Number(channel.vatThresholdAmount) ? channel.vatBelowThresholdPct : channel.vatAboveThresholdPct;
      if (pct != null) return Number(pct);
    }
    return countryVat ?? 0;
  }

  // ---------------------------------------------------------------- resolvers

  /** Package weight for one unit, by the service's charging method. */
  private unitWeightKg(product: any, calcMethod: string | null): number | null {
    const actual =
      product.packageWeightKg != null
        ? Number(product.packageWeightKg)
        : product.productWeightKg != null
          ? Number(product.productWeightKg)
          : null;
    const vol =
      product.packageLengthCm != null && product.packageWidthCm != null && product.packageHeightCm != null
        ? (Number(product.packageLengthCm) * Number(product.packageWidthCm) * Number(product.packageHeightCm)) /
          VOLUMETRIC_DIVISOR
        : null;
    if (calcMethod === 'actual_weight') return actual;
    // Volumetric services charge the greater of the two.
    return vol != null && actual != null ? Math.max(vol, actual) : (vol ?? actual);
  }

  /** Zone + banded rate for a service into a country. Weights outside the bands clamp. */
  private lookupShipping(service: any, countryId: string | null, weightKg: number | null) {
    if (!service || !countryId || weightKg == null) return { zoneName: null as string | null, costEur: null as number | null };
    const zone = (service.zones ?? []).find((z: any) => (z.countries ?? []).some((c: any) => c.countryId === countryId));
    if (!zone) return { zoneName: null, costEur: null };
    const rates = (zone.rates ?? []).slice().sort((a: any, b: any) => Number(a.fromWeightKg) - Number(b.fromWeightKg));
    if (!rates.length) return { zoneName: zone.name, costEur: null };
    // Round the weight UP into the first band whose upper bound covers it. Carriers price bands
    // with tiny gaps between one band's top and the next band's bottom (e.g. …–10.00, then
    // 10.01–10.50), so a parcel that lands in a gap or exactly on a boundary must take the next
    // band up — never fall through. Only a weight above every band clamps to the heaviest band.
    const covering = rates.find((r: any) => weightKg <= Number(r.toWeightKg));
    const chosen = covering ?? rates[rates.length - 1];
    return { zoneName: zone.name, costEur: Number(chosen.chargeEur) };
  }

  /**
   * Shipping service to price with: the user's explicit choice, else the default set on
   * the channel's own country. Mirrors how a sales transaction picks a service, so the
   * profit shown here starts from the same assumptions a real order would.
   */
  private async resolveService(explicitId: string | null | undefined, countryId: string | null) {
    const id =
      explicitId ??
      (countryId
        ? (await this.prisma.country.findUnique({ where: { id: countryId }, select: { defaultShippingServiceId: true } }))
            ?.defaultShippingServiceId ?? null
        : null);
    if (!id) return null;
    return this.prisma.shippingService.findFirst({ where: { id, ...ACTIVE }, include: this.serviceInclude });
  }

  private serviceInclude = {
    zones: { where: ACTIVE, include: { countries: true, rates: { where: ACTIVE } } },
  };

  private async loadChannels(ids?: string[], companyIds?: string[]) {
    return this.prisma.salesChannel.findMany({
      where: { ...ACTIVE, ...(ids?.length ? { id: { in: ids } } : {}), ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      include: { nativeCountry: { select: { id: true, name: true, isoCode: true, vatRate: true } } },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Unit cost for margin work: the moving average once the product has actually been
   * received, otherwise the catalogue cost. Mirrors how COGS is resolved in sales
   * transactions, so a SKU cannot be priced off one cost and then report profit off another.
   *
   * The average is EUR by construction; only the catalogue cost needs converting.
   */
  private async productCostEur(product: any): Promise<number> {
    const avg = Number(product.averageCostEur ?? 0);
    if (avg > 0) return avg;
    const amount = product.purchaseCostAmount != null ? Number(product.purchaseCostAmount) : 0;
    const ccy = product.purchaseCostCurrency ?? 'EUR';
    if (!amount || ccy === 'EUR') return amount;
    const rate = await this.fx.toEur(ccy);
    return rate != null ? round(amount * rate, 4) : amount;
  }

  /**
   * Per-unit FBA costs for a product, by sales channel.
   *
   * Mirrors how the sales-transaction module values a real FBA order, so a forecast and the
   * eventual sale agree: the "shipping" of an FBA unit is the allocated cost of getting it INTO
   * Amazon, and Amazon's fulfilment fee is a separate flat per-unit charge.
   *
   * Matched by product id AND by SKU. An FBA shipment or order line that never linked to a
   * product carries only a SKU, so a product-only match silently finds nothing and the cost
   * reads as if the product had never been sent to Amazon.
   *
   * Returns null rather than 0 for anything it cannot establish. A zero fulfilment fee is never
   * real, and passing one off as a cost makes the listing look profitable on a fiction.
   */
  private async fbaUnitCostsByChannel(
    product: any,
    rates: Map<string, number | null>,
    channels: any[],
  ): Promise<Map<string, { inboundEur: number | null; feeEur: number | null; feeSource: 'product' | 'channel' | null }>> {
    const out = new Map<string, { inboundEur: number | null; feeEur: number | null; feeSource: 'product' | 'channel' | null }>();

    // Every SKU this product is known by: our own, plus whatever each channel lists it as.
    const listings = await this.prisma.channelListing.findMany({
      where: { productId: product.id, ...ACTIVE },
      select: { channelSku: true },
    });
    const skus = [...new Set(
      [product.mainSku, ...listings.map((l) => l.channelSku)]
        .filter((x): x is string => !!x && x.trim() !== '')
        .map((x) => x.trim().toLowerCase()),
    )];
    const skuList = skus.length ? Prisma.join(skus) : Prisma.sql`NULL`;
    const pid = product.id as string;

    // Allocated inbound cost per unit, already in EUR.
    const inboundRows = await this.prisma.$queryRaw<Array<{ ch: string; cost: number; qty: number }>>`
      SELECT COALESCE(s.sales_channel_id::text, '') AS ch,
             SUM(i.allocated_cost_eur) AS cost, SUM(i.quantity) AS qty
      FROM fba_shipment_item i
      JOIN fba_shipment s ON s.id = i.shipment_id
      WHERE i.deleted_at IS NULL AND s.deleted_at IS NULL
        AND (i.product_id = ${pid}::uuid OR lower(trim(i.sku)) IN (${skuList}))
      GROUP BY 1`;
    const inbound = new Map<string, number>();
    for (const r of inboundRows) {
      const qty = Number(r.qty);
      if (qty > 0 && r.cost != null) inbound.set(r.ch, round(Number(r.cost) / qty, 4));
    }

    // Amazon's fulfilment fee per unit, in the channel's currency. A flat size/weight-tier fee,
    // so a per-unit average over settled orders is both the right basis and stable.
    const feeRows = await this.prisma.$queryRaw<Array<{ ch: string; fee: number; qty: number }>>`
      SELECT COALESCE(t.sales_channel_id::text, '') AS ch,
             SUM(i.fba_fulfilment_fee_amount) AS fee, SUM(i.quantity) AS qty
      FROM sales_transaction_item i
      JOIN sales_transaction t ON t.id = i.transaction_id
      WHERE i.deleted_at IS NULL AND t.deleted_at IS NULL
        AND (i.product_id = ${pid}::uuid OR lower(trim(i.sku)) IN (${skuList}))
        AND i.fba_fulfilment_fee_amount > 0 AND i.quantity > 0
      GROUP BY 1`;
    const feeByProduct = new Map<string, number>();
    for (const r of feeRows) {
      const qty = Number(r.qty);
      if (qty > 0) feeByProduct.set(r.ch, Number(r.fee) / qty);
    }

    // Channel-wide average, for a product that has never sold FBA there. A rough proxy — the fee
    // is size/weight banded — but far closer than zero, and the caller labels it as a fallback.
    const chFeeRows = await this.prisma.$queryRaw<Array<{ ch: string; fee: number; qty: number }>>`
      SELECT COALESCE(t.sales_channel_id::text, '') AS ch,
             SUM(i.fba_fulfilment_fee_amount) AS fee, SUM(i.quantity) AS qty
      FROM sales_transaction_item i
      JOIN sales_transaction t ON t.id = i.transaction_id
      WHERE i.deleted_at IS NULL AND t.deleted_at IS NULL
        AND i.fba_fulfilment_fee_amount > 0 AND i.quantity > 0
      GROUP BY 1`;
    const feeByChannel = new Map<string, number>();
    for (const r of chFeeRows) {
      const qty = Number(r.qty);
      if (qty > 0) feeByChannel.set(r.ch, Number(r.fee) / qty);
    }

    for (const c of channels) {
      const ccy = (c.nativeCurrency ?? 'EUR').toUpperCase();
      const rate = ccy === 'EUR' ? 1 : rates.get(ccy) ?? null;
      const nativeFee = feeByProduct.get(c.id) ?? feeByChannel.get(c.id) ?? null;
      const feeSource = feeByProduct.has(c.id) ? 'product' : feeByChannel.has(c.id) ? 'channel' : null;
      out.set(c.id, {
        inboundEur: inbound.get(c.id) ?? null,
        feeEur: nativeFee != null && rate != null ? round(nativeFee * rate, 4) : null,
        feeSource,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- individual

  async individual(dto: IndividualPricingDto, companyIds?: string[]) {
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, ...ACTIVE } });
    if (!product) throw new NotFoundException('Product not found');

    const channels = await this.loadChannels(undefined, companyIds);
    const primary = channels.find((c) => c.id === dto.salesChannelId);
    if (!primary) throw new NotFoundException('Sales channel not found');

    // Defaults resolve from the channel's country, so a price is costed properly the
    // moment a product, channel and price exist — nothing waits on manual entry.
    const service = await this.resolveService(dto.shippingServiceId, primary.nativeCountryId);

    const autoCost = await this.productCostEur(product);
    const rates = await this.fx.ratesFor(channels.map((c) => c.nativeCurrency));

    // FBA changes what "shipping" means: the unit is freighted to Amazon rather than to the
    // buyer, and Amazon charges a fulfilment fee on top. Resolved for every channel so the
    // cross-channel comparison stays on the same fulfilment basis as the channel being priced.
    const isFba = dto.fulfilment === 'FBA';
    const fbaCosts = isFba
      ? await this.fbaUnitCostsByChannel(product, rates, channels)
      : new Map<string, { inboundEur: number | null; feeEur: number | null; feeSource: 'product' | 'channel' | null }>();

    // `value` is in the channel's currency: the buyer-paid price for the channel being
    // priced, or a net figure (valueIsNet) for the cross-channel rows, where net revenue
    // is the fixed quantity and the gross is what we are deriving.
    const build = async (channel: any, value: number, valueIsNet = false) => {
      const ccy = channel.nativeCurrency ?? 'EUR';
      const rate = ccy === 'EUR' ? 1 : rates.get(ccy.toUpperCase()) ?? null;
      const weight = this.unitWeightKg(product, service?.calcMethod ?? null);
      const ship = this.lookupShipping(service, channel.nativeCountryId, weight);
      const tax = this.resolveTax(channel, value, valueIsNet);
      const autoVat = tax.vatPct;
      const autoFee = channel.generalSalesFeePct != null ? Number(channel.generalSalesFeePct) : 0;
      const zeroTax = dto.taxMode === 'zero';

      // FBA: the allocated inbound cost per unit if this product has actually been sent to
      // Amazon on this channel; otherwise fall back to the weight-based estimate, which is the
      // best available proxy for freighting one unit there.
      const fba = fbaCosts.get(channel.id);
      const fbaInboundEur = isFba ? fba?.inboundEur ?? null : null;
      const autoShipEur = isFba ? fbaInboundEur ?? ship.costEur ?? 0 : ship.costEur ?? 0;

      const inputs: CostInputs = {
        costEur: dto.costEur ?? autoCost,
        shippingEur: dto.shippingCostEur ?? autoShipEur,
        fbaFeeEur: isFba ? dto.fbaFeeEur ?? fba?.feeEur ?? 0 : 0,
        // Tracked separately from the applied value: a fee of 0 that we could not establish must
        // not read the same as a fee that genuinely is 0 (which never happens on FBA).

        importPct: dto.importPct ?? 0,
        feePct: dto.feePct ?? autoFee,
        // "No tax" is an explicit choice on the form, so it wins over the resolved rate.
        vatPct: zeroTax ? 0 : (dto.vatPct ?? autoVat),
        // The Amazon Points estimate only applies when tax does (same JP market).
        pointsPct: zeroTax ? 0 : tax.pointsPct,
        taxType: tax.taxType,
      };
      return {
        ccy, rate, weight, ship, inputs, autoVat, autoFee, taxType: tax.taxType, pointsPct: inputs.pointsPct,
        // Where each FBA number came from, so the form can say whether it used a real allocated
        // cost or fell back to an estimate rather than presenting both as equally solid.
        fbaInboundSource: isFba ? (fbaInboundEur != null ? 'allocated' : 'estimated') : null,
        fbaFeeSource: isFba ? (dto.fbaFeeEur != null ? 'override' : fba?.feeSource === 'product' ? 'product' : fba?.feeSource === 'channel' ? 'channel' : 'unknown') : null,
      };
    };

    // --- the channel being priced -------------------------------------------
    const p = await build(primary, dto.price);
    if (p.rate == null) {
      throw new BadRequestException(`No exchange rate available for ${p.ccy} — cannot price this channel right now`);
    }
    const grossEur = dto.price * p.rate;
    const primaryEcon = this.economics(grossEur, p.inputs);

    // --- the same net revenue restated on every other channel ---------------
    // Holding net (ex-VAT) EUR revenue constant is what makes the comparison meaningful:
    // it answers "what must I list at elsewhere to earn the same?", not "what if I
    // charged the same number", which would be meaningless across tax regimes.
    const netEurTarget = primaryEcon.netEur;
    const comparison = await Promise.all(
      channels.map(async (c) => {
        const ccy = c.nativeCurrency ?? 'EUR';
        const rate = ccy === 'EUR' ? 1 : rates.get(ccy.toUpperCase()) ?? null;
        if (rate == null) {
          return { channelId: c.id, channelName: c.name, currency: ccy, countryIso: c.nativeCountry?.isoCode ?? null, priceNative: null, profitEur: null, marginPct: null, unavailable: 'No exchange rate' };
        }
        // Resolve VAT against this channel's own gross, which the threshold rule needs.
        const provisional = await build(c, netEurTarget / rate, true);
        const vatPct = provisional.inputs.vatPct;
        const grossEurHere = netEurTarget * (1 + vatPct / 100);
        const econ = this.economics(grossEurHere, provisional.inputs);
        return {
          channelId: c.id,
          channelName: c.name,
          currency: ccy,
          countryIso: c.nativeCountry?.isoCode ?? null,
          priceNative: round(grossEurHere / rate, ccy === 'JPY' ? 0 : 2),
          vatPct,
          feePct: provisional.inputs.feePct,
          profitEur: econ.profitEur,
          marginPct: econ.marginPct,
          isPrimary: c.id === primary.id,
          unavailable: null as string | null,
        };
      }),
    );

    // Say plainly what could not be resolved. Shipping quietly defaulting to zero would
    // overstate profit, and the user has no way to tell from the number alone.
    const warnings: string[] = [];
    // An FBA fulfilment fee is never zero, so silence here is a missing input, not a free unit.
    if (isFba && p.fbaFeeSource === 'unknown') {
      warnings.push('No FBA fulfilment fee could be established for this product or channel — it is NOT included in the profit below. Enter it from Seller Central.');
    }
    if (isFba && p.fbaInboundSource === 'estimated') {
      warnings.push('This product has no FBA shipment on this channel — the inbound cost is a weight-based estimate, not an allocated cost.');
    }
    if (!service) warnings.push('No shipping service for this destination — shipping is not included.');
    else if (p.weight == null) warnings.push('This product has no weight or dimensions, so shipping could not be priced.');
    else if (p.ship.zoneName == null) warnings.push(`${service.name} has no zone covering this destination — shipping is not included.`);
    else if (p.ship.costEur == null) warnings.push(`${service.name} has no rate band for ${p.weight.toFixed(3)} kg — shipping is not included.`);

    return {
      product: { id: product.id, sku: product.mainSku, title: product.title },
      warnings,
      channel: { id: primary.id, name: primary.name, currency: p.ccy, countryIso: primary.nativeCountry?.isoCode ?? null },
      fxRate: p.rate,
      price: dto.price,
      priceEur: round(grossEur),
      // What the form shows as placeholders, so the user can see what an override replaces.
      auto: {
        costEur: round(autoCost),
        shippingServiceId: service?.id ?? null,
        shippingServiceName: service?.name ?? null,
        // For FBA this is what the form actually applied (allocated inbound, or the weight
        // estimate when the product has never been sent in), not the outbound rate.
        shippingEur: isFba ? p.inputs.shippingEur : p.ship.costEur,
        shippingZone: p.ship.zoneName,
        fulfilment: isFba ? 'FBA' : 'FBM',
        fbaFeeEur: isFba ? p.inputs.fbaFeeEur ?? 0 : null,
        // 'allocated' = a real per-unit cost from FBA shipments; 'estimated' = weight-based
        // fallback. 'unknown' fee = no settled FBA order for this product on this channel yet.
        fbaInboundSource: p.fbaInboundSource,
        fbaFeeSource: p.fbaFeeSource,
        vatPct: p.autoVat,
        taxType: p.taxType,
        taxLabel: taxLabelFor(p.taxType),
        pointsPct: p.pointsPct,
        feePct: p.autoFee,
        importPct: 0,
        actualWeightKg: product.packageWeightKg != null ? Number(product.packageWeightKg) : product.productWeightKg != null ? Number(product.productWeightKg) : null,
        volumetricWeightKg:
          product.packageLengthCm != null && product.packageWidthCm != null && product.packageHeightCm != null
            ? round((Number(product.packageLengthCm) * Number(product.packageWidthCm) * Number(product.packageHeightCm)) / VOLUMETRIC_DIVISOR, 3)
            : null,
        chargeableWeightKg: p.weight != null ? round(p.weight, 3) : null,
      },
      applied: p.inputs,
      breakdown: primaryEcon,
      comparison,
    };
  }

  // ---------------------------------------------------------------- channel listings

  /**
   * Estimated profit + margin for a set of already-listed prices — one per (product, channel).
   * Uses the exact same economics as a booked sale / the pricing calculator (channel fee, the
   * destination tax regime, FX, product cost and the shipping estimate), so a listing's health
   * matches what it would earn if it sold. Keyed by the caller's `key`. Batched: products,
   * channels, FX and services are resolved once.
   */
  /**
   * Per-unit cost inputs for one product shipped to one destination country, in EUR.
   *
   * Public so the repricing floor solver uses the SAME cost basis as Individual Pricing, the
   * listing grid and a booked sale — a floor built on different costs is worse than no floor.
   * `shippingEur` is the outbound carrier charge for FBM (null when no service/zone/weight
   * resolves); FBA callers ignore it and use Amazon's fulfilment fee instead.
   */
  async unitCostInputsEur(productId: string, countryId: string | null): Promise<{ costEur: number | null; shippingEur: number | null; serviceName: string | null; weightKg: number | null }> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, ...ACTIVE } });
    if (!product) return { costEur: null, shippingEur: null, serviceName: null, weightKg: null };
    const costEur = await this.productCostEur(product);
    const service = await this.resolveService(null, countryId);
    const weightKg = this.unitWeightKg(product, service?.calcMethod ?? null);
    const ship = this.lookupShipping(service, countryId, weightKg);
    return { costEur, shippingEur: ship.costEur, serviceName: service?.name ?? null, weightKg };
  }

  /**
   * Destination tax for a sales channel at a given gross price, in the channel's own currency.
   *
   * Public so the repricing floor uses the SAME tax resolution as Individual Pricing, the listing
   * grid and a booked sale. It is more than `Country.vatRate`: JP/AU carry their own regimes, and
   * marketplaces with a VAT threshold (e.g. UK £135) switch rate either side of it — which is why
   * reading the country rate alone returned 0% for GB and halved every UK floor.
   *
   * `grossNative` matters because of that threshold, so pass the price being evaluated.
   */
  async channelTaxFor(salesChannelId: string, grossNative: number): Promise<ChannelTax | null> {
    const [channel] = await this.loadChannels([salesChannelId]);
    if (!channel) return null;
    return this.resolveTax(channel, grossNative);
  }

  async listingEconomics(cells: Array<{ key: string; productId: string; salesChannelId: string; grossNative: number | null; currency: string | null }>): Promise<Map<string, ListingEconomics>> {
    const out = new Map<string, ListingEconomics>();
    const productIds = [...new Set(cells.map((c) => c.productId))];
    const channelIds = [...new Set(cells.map((c) => c.salesChannelId))];
    if (!productIds.length || !channelIds.length) return out;
    const [products, channels] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds }, ...ACTIVE } }),
      this.loadChannels(channelIds),
    ]);
    const pById = new Map(products.map((p) => [p.id, p]));
    const cById = new Map(channels.map((c) => [c.id, c]));
    const rates = await this.fx.ratesFor([...new Set(cells.map((c) => c.currency ?? 'EUR'))]);
    const serviceByChannel = new Map<string, any>();
    for (const c of channels) serviceByChannel.set(c.id, await this.resolveService(null, c.nativeCountryId));
    const costCache = new Map<string, number>();

    for (const cell of cells) {
      const product = pById.get(cell.productId);
      const channel = cById.get(cell.salesChannelId);
      const gross = cell.grossNative;
      if (!product || !channel || gross == null || !(gross > 0)) { out.set(cell.key, { profitEur: null, marginPct: null, loss: false }); continue; }
      const ccy = (cell.currency || channel.nativeCurrency || 'EUR').toUpperCase();
      const rate = ccy === 'EUR' ? 1 : rates.get(ccy) ?? null;
      if (rate == null) { out.set(cell.key, { profitEur: null, marginPct: null, loss: false }); continue; }
      const grossEur = gross * rate;
      if (!costCache.has(product.id)) costCache.set(product.id, await this.productCostEur(product));
      const service = serviceByChannel.get(channel.id);
      const weight = this.unitWeightKg(product, service?.calcMethod ?? null);
      const ship = this.lookupShipping(service, channel.nativeCountryId, weight);
      // Threshold rules (e.g. UK £135) compare against the price in the channel's own
      // currency, so the tax regime is resolved from the native gross, not the EUR figure.
      const tax = this.resolveTax(channel, gross);
      const inputs: CostInputs = {
        costEur: costCache.get(product.id) ?? 0,
        shippingEur: ship.costEur ?? 0,
        importPct: 0,
        feePct: channel.generalSalesFeePct != null ? Number(channel.generalSalesFeePct) : 0,
        vatPct: tax.vatPct,
        pointsPct: tax.pointsPct,
        taxType: tax.taxType,
      };
      const econ = this.economics(grossEur, inputs);
      // Return the inputs too, not just the answer. Individual Pricing lets the operator override
      // cost/shipping/fee/VAT, so when the two screens disagree it is almost always an input that
      // differs — showing them here makes that visible instead of looking like inconsistent maths.
      out.set(cell.key, {
        profitEur: econ.profitEur,
        marginPct: econ.marginPct,
        loss: econ.profitEur < 0,
        priceEur: round(grossEur),
        costEur: econ.costEur,
        shippingEur: econ.shippingEur,
        feeEur: econ.feeEur,
        vatEur: econ.vatEur,
        feePct: inputs.feePct,
        vatPct: inputs.vatPct,
        shippingServiceName: service?.name ?? null,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- bulk

  async bulk(dto: BulkPricingDto, companyIds?: string[]) {
    const products = await this.resolveBulkProducts(dto);
    if (!products.length) throw new BadRequestException('No products matched the selection');

    const channels = await this.loadChannels(dto.salesChannelIds, companyIds);
    if (!channels.length) throw new BadRequestException('Pick at least one sales channel');

    const rates = await this.fx.ratesFor(channels.map((c) => c.nativeCurrency));
    const costs = new Map<string, number>();
    for (const p of products) costs.set(p.id, await this.productCostEur(p));

    // One service per channel. A per-channel override wins; otherwise the channel falls
    // back to the default set on its own country, which is what a real order would use.
    const overrides = dto.shippingServiceByChannel ?? {};
    const serviceByChannel = new Map<string, any>();
    for (const c of channels) {
      serviceByChannel.set(c.id, await this.resolveService(overrides[c.id] ?? dto.shippingServiceId, c.nativeCountryId));
    }

    const columns = channels.map((c) => ({
      channelId: c.id,
      channelName: c.name,
      currency: c.nativeCurrency ?? 'EUR',
      countryIso: c.nativeCountry?.isoCode ?? null,
      shippingServiceId: serviceByChannel.get(c.id)?.id ?? null,
      shippingServiceName: serviceByChannel.get(c.id)?.name ?? null,
      unavailable: (c.nativeCurrency ?? 'EUR') !== 'EUR' && rates.get((c.nativeCurrency ?? 'EUR').toUpperCase()) == null,
    }));

    const rows = products.map((product) => {
      const costEur = costs.get(product.id) ?? 0;
      const cells = channels.map((channel) => {
        const ccy = channel.nativeCurrency ?? 'EUR';
        const rate = ccy === 'EUR' ? 1 : rates.get(ccy.toUpperCase()) ?? null;
        if (rate == null) return { priceNative: null, profitEur: null, marginPct: null, reason: 'No exchange rate' };

        const service = serviceByChannel.get(channel.id) ?? null;
        const weight = this.unitWeightKg(product, service?.calcMethod ?? null);
        const ship = this.lookupShipping(service, channel.nativeCountryId, weight);
        // A weight-based method with no weight on the product would silently price at
        // zero shipping, so the cell is refused rather than quietly understating cost.
        if (service && weight == null) return { priceNative: null, profitEur: null, marginPct: null, reason: 'Missing weight/dimensions' };

        const tax = this.resolveTax(channel, 0);
        const feePct = channel.generalSalesFeePct != null ? Number(channel.generalSalesFeePct) : 0;
        const inputs: CostInputs = {
          costEur,
          shippingEur: dto.shippingCostEur ?? ship.costEur ?? 0,
          importPct: dto.importPct ?? 0,
          feePct,
          // Threshold channels need a price to resolve VAT, and the price is what we are
          // solving for. Solve at the below-threshold rate, then re-solve if that answer
          // turns out to sit above the threshold. JP/AU carry their verified effective rates.
          vatPct: tax.vatPct,
          pointsPct: tax.pointsPct,
          taxType: tax.taxType,
        };

        let gross = this.solveGrossEur(dto.targetMarginPct, inputs);
        if (gross != null && channel.vatThresholdEnabled && channel.vatThresholdAmount != null) {
          const netNative = (gross / (1 + inputs.vatPct / 100)) * rate;
          if (netNative > Number(channel.vatThresholdAmount)) {
            const above = channel.vatAboveThresholdPct != null ? Number(channel.vatAboveThresholdPct) : 0;
            gross = this.solveGrossEur(dto.targetMarginPct, { ...inputs, vatPct: above });
            inputs.vatPct = above;
          }
        }
        if (gross == null) return { priceNative: null, profitEur: null, marginPct: null, reason: 'Margin unreachable after tax and fees' };

        const econ = this.economics(gross, inputs);
        return {
          priceNative: round(gross / rate, ccy === 'JPY' ? 0 : 2),
          profitEur: econ.profitEur,
          marginPct: econ.marginPct,
          reason: null as string | null,
        };
      });
      return { productId: product.id, sku: product.mainSku, title: product.title, costEur: round(costEur), cells };
    });

    return { targetMarginPct: dto.targetMarginPct, columns, rows, productCount: rows.length, channelCount: columns.length };
  }

  /** Product set for a bulk run: an explicit list, or everything under a vendor/brand/type. */
  private async resolveBulkProducts(dto: BulkPricingDto) {
    const base = { ...ACTIVE };
    if (dto.mode === 'specific') {
      if (!dto.productIds?.length) throw new BadRequestException('Pick at least one product');
      return this.prisma.product.findMany({ where: { ...base, id: { in: dto.productIds } }, orderBy: { mainSku: 'asc' } });
    }
    if (!dto.groupId) throw new BadRequestException(`Choose a ${dto.mode}`);
    const key =
      dto.mode === 'vendor' ? { vendorId: dto.groupId }
      : dto.mode === 'brand' ? { brandId: dto.groupId }
      : { productTypeId: dto.groupId };
    return this.prisma.product.findMany({ where: { ...base, ...key }, orderBy: { mainSku: 'asc' } });
  }

  /**
   * The shipping service each channel would use by default — the one set on its native
   * country. Lets the wizard show what will be applied before anything is calculated,
   * and makes a per-channel override an edit of a visible value rather than a blind choice.
   */
  async channelShippingDefaults(channelIds?: string[], companyIds?: string[]) {
    const channels = await this.loadChannels(channelIds, companyIds);
    const countryIds = [...new Set(channels.map((c) => c.nativeCountryId).filter(Boolean) as string[])];
    const countries = countryIds.length
      ? await this.prisma.country.findMany({
          where: { id: { in: countryIds } },
          select: { id: true, name: true, defaultShippingServiceId: true },
        })
      : [];
    const byCountry = new Map(countries.map((c) => [c.id, c]));
    const serviceIds = [...new Set(countries.map((c) => c.defaultShippingServiceId).filter(Boolean) as string[])];
    const services = serviceIds.length
      ? await this.prisma.shippingService.findMany({ where: { id: { in: serviceIds }, ...ACTIVE }, select: { id: true, name: true } })
      : [];
    const byService = new Map(services.map((s) => [s.id, s.name]));

    return channels.map((c) => {
      const country = c.nativeCountryId ? byCountry.get(c.nativeCountryId) : null;
      const svcId = country?.defaultShippingServiceId ?? null;
      return {
        channelId: c.id,
        channelName: c.name,
        currency: c.nativeCurrency ?? 'EUR',
        countryIso: c.nativeCountry?.isoCode ?? null,
        countryName: country?.name ?? null,
        defaultServiceId: svcId,
        defaultServiceName: svcId ? byService.get(svcId) ?? null : null,
      };
    });
  }

  /** Counts per vendor/brand/type, so the picker can show "N products" without a second call. */
  async groups(mode: 'vendor' | 'brand' | 'type') {
    if (mode === 'vendor') {
      const rows = await this.prisma.product.groupBy({ by: ['vendorId'], where: { ...ACTIVE, vendorId: { not: null } }, _count: true });
      const vendors = await this.prisma.vendor.findMany({ where: { id: { in: rows.map((r) => r.vendorId!) } }, select: { id: true, name: true } });
      return this.zip(rows, vendors, 'vendorId');
    }
    if (mode === 'brand') {
      const rows = await this.prisma.product.groupBy({ by: ['brandId'], where: { ...ACTIVE, brandId: { not: null } }, _count: true });
      const brands = await this.prisma.brand.findMany({ where: { id: { in: rows.map((r) => r.brandId!) } }, select: { id: true, name: true } });
      return this.zip(rows, brands, 'brandId');
    }
    const rows = await this.prisma.product.groupBy({ by: ['productTypeId'], where: { ...ACTIVE, productTypeId: { not: null } }, _count: true });
    const types = await this.prisma.productType.findMany({ where: { id: { in: rows.map((r) => r.productTypeId!) } }, select: { id: true, name: true } });
    return this.zip(rows, types, 'productTypeId');
  }

  private zip(rows: any[], named: { id: string; name: string }[], key: string) {
    const byId = new Map(named.map((n) => [n.id, n.name]));
    return rows
      .map((r) => ({ id: r[key] as string, name: byId.get(r[key]) ?? '—', productCount: r._count as number }))
      .filter((r) => r.name !== '—')
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
