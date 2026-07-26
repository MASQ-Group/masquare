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
      select: { id: true, name: true, marketplace: true, channelType: true, targetSalesChannelId: true },
    });
    const scIds = [...new Set(rows.map((r) => r.targetSalesChannelId).filter((v): v is string => !!v))];
    const scs = scIds.length ? await this.prisma.salesChannel.findMany({ where: { id: { in: scIds } }, select: { id: true, chipBgColor: true, nativeCurrency: true, nativeCountry: { select: { isoCode: true } } } }) : [];
    const scById = new Map(scs.map((s) => [s.id, s]));
    const agg = await this.prisma.channelListing.groupBy({ by: ['integrationId'], _max: { lastPulledAt: true }, _count: { _all: true } });
    const byInt = new Map(agg.map((a) => [a.integrationId, a]));
    return rows.map((r, i) => {
      const sc = r.targetSalesChannelId ? scById.get(r.targetSalesChannelId) : null;
      return {
        id: r.id,
        name: r.name,
        marketplace: r.marketplace,
        channelType: r.channelType,
        salesChannelId: r.targetSalesChannelId ?? null,
        // 2-letter ISO for the flag: prefer the linked channel's native country, else the
        // Amazon marketplace suffix (UK→GB), else derive nothing.
        countryIso: sc?.nativeCountry?.isoCode ?? this.marketplaceIso(r.marketplace),
        currency: sc?.nativeCurrency ?? null,
        color: sc?.chipBgColor || PALETTE[i % PALETTE.length],
        listingCount: byInt.get(r.id)?._count._all ?? 0,
        lastPulledAt: byInt.get(r.id)?._max.lastPulledAt ?? null,
      };
    });
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
  async sync(integrationIds?: string[], companyIds?: string[]) {
    // "Sync all" (no explicit ids) syncs Amazon only — the one channel type with a
    // listings connector today. A selective sync may target any connected channel;
    // types without a listings connector yet are reported, not silently dropped.
    const selective = !!integrationIds?.length;
    const where: Prisma.ChannelIntegrationWhereInput = {
      ...ACTIVE, status: 'active',
      ...(selective ? { id: { in: integrationIds } } : { channelType: 'amazon' }),
      ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
    };
    const ints = await this.prisma.channelIntegration.findMany({ where, select: { id: true, name: true, channelType: true, targetCompanyId: true } });
    const skuMap = await this.buildSkuMap();
    const now = new Date();
    const results: Array<{ integrationId: string; name: string; ok: boolean; pulled?: number; message?: string }> = [];
    for (const intg of ints) {
      if (intg.channelType !== 'amazon') {
        results.push({ integrationId: intg.id, name: intg.name, ok: false, message: `Listings sync for ${intg.channelType} isn't available yet` });
        continue;
      }
      try {
        const listings = await this.integrations.fetchAmazonListings(intg.id);
        for (const l of listings) {
          const productId = skuMap.get((l.sku ?? '').trim().toLowerCase()) ?? null;
          await this.prisma.channelListing.upsert({
            where: { integrationId_channelSku: { integrationId: intg.id, channelSku: l.sku } },
            create: { integrationId: intg.id, companyId: intg.targetCompanyId, channelSku: l.sku, productId, asin: l.asin, title: l.title, listedQuantity: l.quantity, listedPrice: l.price, currency: l.currency, fulfilmentChannel: l.fulfilmentChannel, listingStatus: l.status, lastPulledAt: now },
            update: { companyId: intg.targetCompanyId, productId, asin: l.asin, title: l.title, listedQuantity: l.quantity, listedPrice: l.price, currency: l.currency, fulfilmentChannel: l.fulfilmentChannel, listingStatus: l.status, lastPulledAt: now },
          });
        }
        results.push({ integrationId: intg.id, name: intg.name, ok: true, pulled: listings.length });
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
          channelListings: { where: query.companyIds ? { companyId: { in: query.companyIds } } : undefined, select: { integrationId: true, channelSku: true, asin: true, listedPrice: true, currency: true, listedQuantity: true, fulfilmentChannel: true, listingStatus: true } },
        },
      }),
    ]);
    const rows = products.map((p) => {
      const cells: Record<string, any> = {};
      for (const l of p.channelListings) cells[l.integrationId] = this.cellOf(l);
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
