import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { MARKETPLACE_TO_ISO } from '../config/repricing.config';
import { parseFeesEstimate, type ParsedFees } from './fees-parse';
import { fullScopeIntegrationWhere } from '../../common/amazon-scope';

// Fees are DATA, not code (spec §4.3): this refreshes per-SKU fee estimates from Amazon's
// getMyFeesEstimate into RepricingFeeEstimate, which the floor solver consumes. Reuses the
// Amazon SP-API auth in IntegrationsService (needs the Pricing role — confirmed granted).
//
// The referral % is price-dependent and comes from the bracket schedule in the solver; from the
// API we take the PRICE-INDEPENDENT fixed fees (FBA fulfilment, media closing), so we query at a
// reference price (the SKU's current price, else a nominal) purely to obtain those.

// Reference price used only to ask Amazon for a fee estimate, in the MARKETPLACE's currency
// (the request is sent with args.currency) — so this is 20 of whatever that currency is, not €20.
const NOMINAL_REFERENCE_CENTS = 2000;

@Injectable()
export class FeeService {
  private readonly logger = new Logger(FeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  /**
   * Refresh fees for one SKU × marketplace and store a RepricingFeeEstimate row. Returns true on
   * success. Resolves the Amazon integration for the marketplace's country; a missing integration
   * or a failed API call leaves fees unchanged (the SKU stays EXCLUDED as FEES_UNKNOWN upstream).
   */
  /**
   * Fees for an ASIN we do not list yet.
   *
   * Not persisted: RepricingFeeEstimate is keyed by our SKU, and there is no SKU here — this is a
   * quote for a listing that does not exist. Returned to the caller and forgotten.
   */
  async estimateForAsin(args: {
    integrationId: string;
    asin: string;
    currency: string;
    isFba: boolean;
    referencePriceCents: number | null;
  }): Promise<ParsedFees | null> {
    const refCents = args.referencePriceCents ?? NOMINAL_REFERENCE_CENTS;
    const res = await this.integrations.getFeesEstimateForAsin(
      args.integrationId, args.asin, refCents / 100, args.currency, args.isFba,
    );
    if (!res.ok) {
      this.logger.warn(`feesEstimate by ASIN failed for ${args.asin}: ${res.message ?? res.status}`);
      return null;
    }
    return parseFeesEstimate(res.payload);
  }

  async refreshFeesForSku(args: {
    sku: string;
    asin: string | null;
    marketplaceId: string;
    currency: string;
    fulfillment: string;
    currentPriceCents: number | null;
  }): Promise<boolean> {
    const iso = MARKETPLACE_TO_ISO[args.marketplaceId];
    if (!iso) {
      this.logger.warn(`No ISO mapping for marketplace ${args.marketplaceId}; cannot refresh fees.`);
      return false;
    }
    const integration = await this.prisma.channelIntegration.findFirst({
      where: { channelType: 'amazon', marketplace: iso, deletedAt: null, ...(await fullScopeIntegrationWhere(this.prisma)) },
      select: { id: true },
    });
    if (!integration) {
      this.logger.warn(`No Amazon integration for ${iso} (${args.marketplaceId}); cannot refresh fees for ${args.sku}.`);
      return false;
    }

    const isFba = args.fulfillment === 'FBA' || args.fulfillment === 'SFP';
    const refCents = args.currentPriceCents ?? NOMINAL_REFERENCE_CENTS;

    const res = await this.integrations.getMyFeesEstimate(integration.id, args.sku, refCents / 100, args.currency, isFba);
    if (!res.ok) {
      this.logger.warn(`getMyFeesEstimate failed for ${args.sku}@${args.marketplaceId}: ${res.message ?? res.status}`);
      return false;
    }

    const parsed = parseFeesEstimate(res.payload);
    await this.prisma.repricingFeeEstimate.create({
      data: {
        sku: args.sku,
        asin: args.asin,
        marketplaceId: args.marketplaceId,
        priceCents: refCents,
        referralFeeCents: parsed.referralFeeCents,
        fbaFulfillmentFeeCents: parsed.fbaFulfillmentFeeCents,
        closingFeeCents: parsed.closingFeeCents,
        totalFeeCents: parsed.totalFeeCents,
        raw: (res.payload as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
    return true;
  }
}
