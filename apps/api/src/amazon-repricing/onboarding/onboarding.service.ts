import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ISO_TO_MARKETPLACE } from '../config/repricing.config';
import type { ProgressSink } from '../../jobs/jobs.service';
import { fullScopeIntegrationWhere } from '../../common/amazon-scope';

// Onboarding (spec §3.3): seed one RepricingSkuPricing row per matched Amazon listing so the
// engine has SKUs to evaluate. Rows start EXCLUDED (no floor yet); the floor-service promotes
// them to SHADOW once fees + floors compute. Re-runnable — refreshes listing-derived fields
// (asin, fulfilment, current price) without disturbing engine-managed state (strategy, floors,
// automationState, params).

export interface SyncResult {
  scannedListings: number;
  created: number;
  updated: number;
  skipped: number;
  /** Channel listings in scope that are NOT matched to a product. They cannot be onboarded —
   *  without the linked product there is no cost basis, so no floor can be computed (§3.3). This
   *  is the usual reason the onboarded count is lower than the SKU count Amazon shows. */
  unmatchedListings: number;
  /** Every listing in scope, matched or not (= scannedListings + unmatchedListings). */
  totalListings: number;
}

/** ChannelListing.fulfilmentChannel (FBM | FBA) → our fulfillment enum. Default FBM (safest). */
function mapFulfillment(channel: string | null | undefined): string {
  const c = (channel ?? '').toUpperCase();
  return c === 'FBA' ? 'FBA' : 'FBM';
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seed/refresh RepricingSkuPricing from matched Amazon listings.
   *
   * `marketplace` (ISO-2, e.g. 'UK') scopes the run to one marketplace. Onboarding everything at
   * once is rarely what you want during rollout: every onboarded SKU is then fee-refreshed by the
   * nightly cron with one live SP-API call apiece, so pilot one marketplace, watch a cycle, widen.
   */
  async syncSkuPricingFromListings(opts: { marketplace?: string; progress?: ProgressSink } = {}): Promise<SyncResult> {
    const iso = opts.marketplace?.trim().toUpperCase();
    const integrations = await this.prisma.channelIntegration.findMany({
      where: { channelType: 'amazon', deletedAt: null, ...(iso ? { marketplace: iso } : {}), ...(await fullScopeIntegrationWhere(this.prisma)) },
      select: { id: true, marketplace: true },
    });
    if (integrations.length === 0) {
      this.logger.warn(`Onboarding: no Amazon integration${iso ? ` for ${iso}` : ''} — nothing to do.`);
      return { scannedListings: 0, created: 0, updated: 0, skipped: 0, unmatchedListings: 0, totalListings: 0 };
    }
    const isoByIntegration = new Map(integrations.map((i) => [i.id, i.marketplace]));

    // Amazon listings matched to a product are the automatable pool (§3.3).
    const listings = await this.prisma.channelListing.findMany({
      where: { integrationId: { in: [...isoByIntegration.keys()] }, productId: { not: null } },
      select: { companyId: true, integrationId: true, channelSku: true, asin: true, productId: true, listedPrice: true, currency: true, fulfilmentChannel: true },
    });

    // Count the unmatched ones too, so the caller can see WHY the onboarded total is lower than the
    // SKU count Amazon reports, instead of being left to guess.
    const unmatchedListings = await this.prisma.channelListing.count({
      where: { integrationId: { in: [...isoByIntegration.keys()] }, productId: null },
    });

    opts.progress?.setTotal(listings.length);

    const result: SyncResult = {
      scannedListings: listings.length,
      created: 0,
      updated: 0,
      skipped: 0,
      unmatchedListings,
      totalListings: listings.length + unmatchedListings,
    };

    for (const l of listings) {
      const iso = isoByIntegration.get(l.integrationId) ?? '';
      const marketplaceId = ISO_TO_MARKETPLACE[iso];
      if (!marketplaceId) {
        result.skipped += 1; // integration's country isn't a supported Amazon marketplace (DE/FR/ES)
        opts.progress?.tick(false);
        continue;
      }
      const currentPriceCents = l.listedPrice != null ? Math.round(l.listedPrice * 100) : null;
      const fulfillment = mapFulfillment(l.fulfilmentChannel);

      const existing = await this.prisma.repricingSkuPricing.findUnique({
        where: { marketplaceId_sku: { marketplaceId, sku: l.channelSku } },
        select: { id: true },
      });

      if (existing) {
        // Refresh only listing-derived fields — never touch engine-managed state.
        await this.prisma.repricingSkuPricing.update({
          where: { id: existing.id },
          data: { asin: l.asin, productId: l.productId, fulfillment, currentPriceCents, currency: l.currency ?? 'EUR' },
        });
        result.updated += 1;
      } else {
        await this.prisma.repricingSkuPricing.create({
          data: {
            companyId: l.companyId,
            productId: l.productId,
            sku: l.channelSku,
            asin: l.asin,
            marketplaceId,
            currency: l.currency ?? 'EUR',
            fulfillment,
            strategy: 'BUY_BOX',
            automationState: 'EXCLUDED', // floor-service promotes to SHADOW once floors compute
            exclusionReason: 'FLOOR_UNKNOWN',
            currentPriceCents,
          },
        });
        result.created += 1;
      }
      opts.progress?.tick(true);
    }

    this.logger.log(`Onboarding sync${iso ? ` [${iso}]` : ' [all marketplaces]'}: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped of ${result.scannedListings} listings.`);
    return result;
  }

  /** Data-readiness summary (§3.3) — counts by automation state and exclusion reason. */
  async readinessSummary(): Promise<{ total: number; byState: Record<string, number>; byExclusion: Record<string, number> }> {
    const [byStateRaw, byExclusionRaw, total] = await Promise.all([
      this.prisma.repricingSkuPricing.groupBy({ by: ['automationState'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.repricingSkuPricing.groupBy({ by: ['exclusionReason'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.repricingSkuPricing.count({ where: { deletedAt: null } }),
    ]);
    const byState = Object.fromEntries(byStateRaw.map((r) => [r.automationState, r._count._all]));
    const byExclusion = Object.fromEntries(byExclusionRaw.map((r) => [r.exclusionReason ?? 'none', r._count._all]));
    return { total, byState, byExclusion };
  }
}
