import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PricingService } from '../pricing/pricing.service';

const ACTIVE = { deletedAt: null };
// Per-channel accent dots (fallback palette; overridden by the SalesChannel chip colour if set).
const PALETTE = ['#F59B00', '#0064D2', '#6E56CF', '#7AB55C', '#E0447B', '#14A79D', '#C77B22', '#2FA8A0'];

export interface ListingsQuery {
  q?: string;
  channelId?: string;
  brandId?: string;
  vendorId?: string;
  productTypeId?: string;
  /** Enforced company isolation: the companies the caller may see. */
  companyIds?: string[];
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ChannelListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly pricing: PricingService,
  ) {}

  /** Derive a listing status the UI colours by: live | low | oos | paused | error. */
  private deriveStatus(l: { listedQuantity: number | null; listingStatus: string | null; fulfilmentChannel: string | null }): string {
    if (l.fulfilmentChannel === 'FBA') return 'live'; // Amazon controls FBA quantity
    const s = (l.listingStatus ?? '').toUpperCase();
    if (l.listedQuantity != null && l.listedQuantity <= 0) return 'oos';
    if (s && !s.includes('BUYABLE')) return 'paused'; // e.g. DISCOVERABLE-only
    if (l.listedQuantity != null && l.listedQuantity <= 5) return 'low';
    return 'live';
  }

  /** The connected channels (Amazon marketplaces) that can carry listings. */
  async channels(companyIds?: string[]) {
    const rows = await this.prisma.channelIntegration.findMany({
      where: { ...ACTIVE, status: 'active', channelType: { in: ['amazon', 'ebay', 'onbuy'] }, ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, marketplace: true, channelType: true, targetSalesChannelId: true, targetCompanyId: true },
    });
    const scopeCompany = companyIds ? { companyId: { in: companyIds } } : {};

    // Per-marketplace listing counts (eBay spans marketplaces on one integration → many columns).
    const mktRows = await this.prisma.channelListing.groupBy({
      by: ['integrationId', 'marketplace'], where: { marketplace: { not: '' }, ...scopeCompany },
      _max: { lastPulledAt: true }, _count: { _all: true },
    });
    const marketsByInt = new Map<string, Array<{ marketplace: string; count: number; lastPulledAt: Date | null }>>();
    for (const m of mktRows) {
      const arr = marketsByInt.get(m.integrationId) ?? [];
      arr.push({ marketplace: m.marketplace, count: m._count._all, lastPulledAt: m._max.lastPulledAt });
      marketsByInt.set(m.integrationId, arr);
    }
    // Single-column (marketplace '') listing counts, for Amazon / OnBuy.
    const agg = await this.prisma.channelListing.groupBy({ by: ['integrationId'], where: { marketplace: '', ...scopeCompany }, _max: { lastPulledAt: true }, _count: { _all: true } });
    const byInt = new Map(agg.map((a) => [a.integrationId, a]));

    // Each eBay column maps to the company's matching eBay sales channel (by ISO), exactly like
    // eBay order routing — that gives the column its flag, currency and economics.
    const ebayCompanyIds = [...new Set(rows.filter((r) => r.channelType === 'ebay').map((r) => r.targetCompanyId).filter((v): v is string => !!v))];
    const ebayScs = ebayCompanyIds.length ? await this.prisma.salesChannel.findMany({
      where: { deletedAt: null, companyId: { in: ebayCompanyIds }, name: { contains: 'ebay', mode: 'insensitive' } },
      select: { id: true, name: true, chipBgColor: true, nativeCurrency: true, companyId: true, nativeCountry: { select: { isoCode: true } } },
    }) : [];
    const ebayScByCompanyIso = new Map<string, (typeof ebayScs)[number]>();
    for (const sc of ebayScs) if (sc.nativeCountry?.isoCode) ebayScByCompanyIso.set(`${sc.companyId}:${sc.nativeCountry.isoCode}`, sc);

    // Target sales channel for single-column integrations.
    const scIds = [...new Set(rows.map((r) => r.targetSalesChannelId).filter((v): v is string => !!v))];
    const scs = scIds.length ? await this.prisma.salesChannel.findMany({ where: { id: { in: scIds } }, select: { id: true, chipBgColor: true, nativeCurrency: true, nativeCountry: { select: { isoCode: true } } } }) : [];
    const scById = new Map(scs.map((s) => [s.id, s]));

    const out: any[] = [];
    let colorIdx = 0;
    for (const r of rows) {
      const markets = marketsByInt.get(r.id);
      if (r.channelType === 'ebay' && markets?.length) {
        for (const m of markets.slice().sort((a, b) => a.marketplace.localeCompare(b.marketplace))) {
          const sc = r.targetCompanyId ? ebayScByCompanyIso.get(`${r.targetCompanyId}:${m.marketplace}`) : null;
          out.push({
            id: `${r.id}:${m.marketplace}`,
            name: sc?.name ?? `${r.name} ${m.marketplace}`,
            marketplace: m.marketplace,
            channelType: r.channelType,
            salesChannelId: sc?.id ?? null,
            countryIso: sc?.nativeCountry?.isoCode ?? m.marketplace,
            currency: sc?.nativeCurrency ?? null,
            color: sc?.chipBgColor || PALETTE[colorIdx++ % PALETTE.length],
            listingCount: m.count,
            lastPulledAt: m.lastPulledAt,
          });
        }
        continue;
      }
      const sc = r.targetSalesChannelId ? scById.get(r.targetSalesChannelId) : null;
      const a = byInt.get(r.id);
      out.push({
        id: r.id,
        name: r.name,
        marketplace: r.marketplace,
        channelType: r.channelType,
        salesChannelId: r.targetSalesChannelId ?? null,
        countryIso: sc?.nativeCountry?.isoCode ?? this.marketplaceIso(r.marketplace),
        currency: sc?.nativeCurrency ?? null,
        color: sc?.chipBgColor || PALETTE[colorIdx++ % PALETTE.length],
        listingCount: a?._count._all ?? 0,
        lastPulledAt: a?._max.lastPulledAt ?? null,
      });
    }
    return out;
  }

  /** Best-effort 2-letter flag ISO from an Amazon marketplace label (e.g. "Amazon.co.uk", "US", "DE"). */
  private marketplaceIso(marketplace: string | null): string | null {
    if (!marketplace) return null;
    const m = marketplace.toLowerCase();
    const map: Record<string, string> = {
      'co.uk': 'GB', uk: 'GB', com: 'US', us: 'US', ca: 'CA', 'com.mx': 'MX', mx: 'MX',
      'com.br': 'BR', br: 'BR', de: 'DE', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', se: 'SE',
      pl: 'PL', 'com.be': 'BE', be: 'BE', 'com.tr': 'TR', tr: 'TR', ae: 'AE', sa: 'SA',
      'com.au': 'AU', au: 'AU', 'co.jp': 'JP', jp: 'JP', in: 'IN', sg: 'SG', eg: 'EG',
    };
    for (const [k, v] of Object.entries(map)) if (m.endsWith(k) || m === k) return v;
    // Fallback: a bare 2-letter code
    const two = m.replace(/[^a-z]/g, '');
    return two.length === 2 ? two.toUpperCase() : null;
  }

  /** SKU (main + alias, lowercased) → productId, for matching pulled listings to our catalogue. */
  private async buildSkuMap() {
    const products = await this.prisma.product.findMany({
      where: ACTIVE,
      select: { id: true, mainSku: true, aliases: { where: ACTIVE, select: { skuValue: true } } },
    });
    const m = new Map<string, string>();
    for (const p of products) {
      m.set(p.mainSku.trim().toLowerCase(), p.id);
      for (const a of p.aliases) m.set(a.skuValue.trim().toLowerCase(), p.id);
    }
    return m;
  }

  /** Pull listings from the given (or all active Amazon) channels into ChannelListing. */
  // Channel types we can pull listings from today.
  private static readonly LISTING_CHANNELS = ['amazon', 'ebay', 'onbuy'];

  async sync(integrationIds?: string[], companyIds?: string[]) {
    // "Sync all" (no explicit ids) syncs every channel type with a listings connector.
    // A selective sync may target any connected channel; types without a listings connector
    // yet are reported, not silently dropped.
    const selective = !!integrationIds?.length;
    const where: Prisma.ChannelIntegrationWhereInput = {
      ...ACTIVE, status: 'active',
      ...(selective ? { id: { in: integrationIds } } : { channelType: { in: ChannelListingsService.LISTING_CHANNELS } }),
      ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
    };
    const ints = await this.prisma.channelIntegration.findMany({ where, select: { id: true, name: true, channelType: true, targetCompanyId: true } });
    const skuMap = await this.buildSkuMap();
    const now = new Date();
    const results: Array<{ integrationId: string; name: string; ok: boolean; pulled?: number; message?: string }> = [];
    for (const intg of ints) {
      try {
        const listings =
          intg.channelType === 'amazon' ? await this.integrations.fetchAmazonListings(intg.id)
          : intg.channelType === 'ebay' ? await this.integrations.fetchEbayListings(intg.id)
          : intg.channelType === 'onbuy' ? await this.integrations.fetchOnBuyListings(intg.id)
          : null;
        if (!listings) {
          results.push({ integrationId: intg.id, name: intg.name, ok: false, message: `Listings sync for ${intg.channelType} isn't available yet` });
          continue;
        }
        // Build rows in memory, then REPLACE this integration's listings in bulk. Row-by-row
        // upserts don't scale to thousands of eBay listings (they time out mid-sync); a delete +
        // chunked createMany is a handful of queries. Since we pull the full set each time, a
        // full replace also drops delisted items and the old single-column ('') eBay rows.
        // eBay keys by marketplace (per-market columns); single-market channels use ''.
        const seen = new Set<string>();
        const data = [] as Prisma.ChannelListingCreateManyInput[];
        for (const l of listings) {
          if (!l.sku) continue;
          const marketplace = (l.marketplace ?? '').toString();
          const key = `${l.sku} ${marketplace}`;
          if (seen.has(key)) continue; // one row per (sku, marketplace) — avoids unique clashes
          seen.add(key);
          data.push({
            integrationId: intg.id, companyId: intg.targetCompanyId, channelSku: l.sku, marketplace,
            productId: skuMap.get(l.sku.trim().toLowerCase()) ?? null,
            asin: l.asin, title: l.title, listedQuantity: l.quantity, listedPrice: l.price,
            currency: l.currency, fulfilmentChannel: l.fulfilmentChannel, listingStatus: l.status, lastPulledAt: now,
          });
        }
        const ops: Prisma.PrismaPromise<unknown>[] = [this.prisma.channelListing.deleteMany({ where: { integrationId: intg.id } })];
        for (let i = 0; i < data.length; i += 1000) ops.push(this.prisma.channelListing.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true }));
        await this.prisma.$transaction(ops);
        results.push({ integrationId: intg.id, name: intg.name, ok: true, pulled: data.length });
      } catch (e: any) {
        results.push({ integrationId: intg.id, name: intg.name, ok: false, message: (e?.message ?? 'failed').toString().slice(0, 160) });
      }
    }
    return { channels: results, total: results.reduce((s, r) => s + (r.pulled ?? 0), 0) };
  }

  private cellOf(l: any) {
    return {
      integrationId: l.integrationId,
      channelSku: l.channelSku,
      asin: l.asin,
      listed: true,
      price: l.listedPrice,
      currency: l.currency,
      quantity: l.listedQuantity,
      fulfilmentChannel: l.fulfilmentChannel,
      status: this.deriveStatus(l),
    };
  }

  /** Dashboard rows: products that are listed somewhere, each with its per-channel cells. */
  async dashboard(query: ListingsQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 25));
    const q = query.q?.trim();
    // Company isolation: only listings owned by a company the user may see.
    const listingScope: Prisma.ChannelListingWhereInput = {
      ...(query.companyIds ? { companyId: { in: query.companyIds } } : {}),
      ...(query.channelId ? { integrationId: query.channelId } : {}),
    };
    const where: Prisma.ProductWhereInput = {
      ...ACTIVE,
      channelListings: { some: listingScope },
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.productTypeId ? { productTypeId: query.productTypeId } : {}),
      ...(q ? { OR: [{ mainSku: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }, { aliases: { some: { skuValue: { contains: q, mode: 'insensitive' } } } }] } : {}),
    };
    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where, orderBy: { mainSku: 'asc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, mainSku: true, title: true,
          brand: { select: { name: true } },
          availability: { select: { quantity: true } },
          channelListings: { where: query.companyIds ? { companyId: { in: query.companyIds } } : undefined, select: { integrationId: true, marketplace: true, channelSku: true, asin: true, listedPrice: true, currency: true, listedQuantity: true, fulfilmentChannel: true, listingStatus: true } },
        },
      }),
    ]);
    // A "column" is (integration × marketplace). eBay listings key by both so each marketplace
    // gets its own cell; single-marketplace channels (marketplace '') key by integration alone.
    const colId = (l: any) => (l.marketplace ? `${l.integrationId}:${l.marketplace}` : l.integrationId);
    const rows = products.map((p) => {
      const cells: Record<string, any> = {};
      for (const l of p.channelListings) cells[colId(l)] = this.cellOf(l);
      return {
        productId: p.id, sku: p.mainSku, title: p.title, brand: p.brand?.name ?? null,
        masterStock: p.availability?.quantity ?? null,
        listedCount: p.channelListings.length,
        cells,
      };
    });

    // Estimated profit/margin per listed cell, using the same economics as a booked sale.
    const channels = await this.channels(query.companyIds);
    const scByInt = new Map(channels.map((c) => [c.id, c.salesChannelId]));
    const econInputs: Array<{ key: string; productId: string; salesChannelId: string; grossNative: number | null; currency: string | null }> = [];
    for (const row of rows) {
      for (const [integrationId, cell] of Object.entries(row.cells)) {
        const salesChannelId = scByInt.get(integrationId);
        if (!salesChannelId || cell.price == null) continue;
        econInputs.push({ key: `${row.productId}:${integrationId}`, productId: row.productId, salesChannelId, grossNative: cell.price, currency: cell.currency });
      }
    }
    const econ = await this.pricing.listingEconomics(econInputs);
    for (const row of rows) {
      for (const [integrationId, cell] of Object.entries(row.cells)) {
        const e = econ.get(`${row.productId}:${integrationId}`);
        cell.profitEur = e?.profitEur ?? null;
        cell.marginPct = e?.marginPct ?? null;
        cell.loss = e?.loss ?? false;
      }
    }
    return { items: rows, total, page, pageSize };
  }

  /** One product across all its channels (for the detail page). Real listing data only —
   *  performance analytics (units sold, buy box, revenue) are placeholders in the UI. */
  async detail(productId: string, companyIds?: string[]) {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, ...ACTIVE },
      select: {
        id: true, mainSku: true, title: true,
        brand: { select: { name: true } },
        availability: { select: { quantity: true, updatedAt: true } },
        channelListings: {
          where: companyIds ? { companyId: { in: companyIds } } : undefined,
          select: { integrationId: true, channelSku: true, asin: true, listedPrice: true, currency: true, listedQuantity: true, fulfilmentChannel: true, listingStatus: true, lastPulledAt: true },
          orderBy: { integration: { name: 'asc' } },
        },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    const channels = await this.channels(companyIds);
    const byInt = new Map(p.channelListings.map((l) => [l.integrationId, l]));
    const econInputs = channels
      .filter((ch) => ch.salesChannelId && byInt.get(ch.id)?.listedPrice != null)
      .map((ch) => ({ key: ch.id, productId: p.id, salesChannelId: ch.salesChannelId!, grossNative: byInt.get(ch.id)!.listedPrice, currency: byInt.get(ch.id)!.currency }));
    const econ = await this.pricing.listingEconomics(econInputs);
    const perChannel = channels.map((ch) => {
      const l = byInt.get(ch.id);
      const e = econ.get(ch.id);
      return {
        integrationId: ch.id, name: ch.name, color: ch.color, currency: ch.currency,
        countryIso: ch.countryIso,
        listed: !!l,
        price: l?.listedPrice ?? null,
        priceCurrency: l?.currency ?? null,
        quantity: l?.listedQuantity ?? null,
        fulfilmentChannel: l?.fulfilmentChannel ?? null,
        status: l ? this.deriveStatus(l) : null,
        profitEur: e?.profitEur ?? null,
        marginPct: e?.marginPct ?? null,
        loss: e?.loss ?? false,
        lastPulledAt: l?.lastPulledAt ?? null,
      };
    });
    return {
      productId: p.id, sku: p.mainSku, title: p.title, brand: p.brand?.name ?? null,
      masterStock: p.availability?.quantity ?? null,
      listedCount: p.channelListings.length,
      channelCount: channels.length,
      unitsLive: perChannel.filter((c) => c.listed).reduce((s, c) => s + (c.quantity ?? 0), 0),
      lastSyncedAt: p.channelListings.map((l) => l.lastPulledAt).filter(Boolean).sort().slice(-1)[0] ?? null,
      channels: perChannel,
    };
  }
}
