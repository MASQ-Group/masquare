import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { AutomationState } from '../engine/types';
import { checkSafety } from '../engine/safety-layer';
import { REPRICING_DEFAULTS, ISO_TO_MARKETPLACE, MARKETPLACE_TO_ISO } from '../config/repricing.config';
import { resolveWriteMode } from './write-mode';
import { RepricingControlService } from './control.service';

// The price-writer (spec §6): the ONLY component that submits a price to Amazon. It runs the
// independent safety layer (§6.3) as the final gate, then writes via patchListingsItem — as a
// VALIDATION_PREVIEW dry-run unless the SKU is LIVE and live-writes are enabled (write-mode.ts).
// It records the submission outcome on the decision row and the SKU's volatile state. It has NO
// strategy knowledge — the intended price is already decided upstream.
//
// Live-writes + the kill switch are read from the DB control row (RepricingControlService) so ops
// can flip them at runtime; the env AMZ_REPRICING_KILL_SWITCH ORs in as a last-resort hard stop.

const envKillSwitch = (): boolean => process.env.AMZ_REPRICING_KILL_SWITCH === 'true';

export interface SubmitInput {
  decisionId: string;
  skuPricingId: string;
  sku: string;
  marketplaceId: string;
  currency: string;
  automationState: AutomationState;
  intendedPriceCents: number;
  breakevenCents: number;
  currentPriceCents: number | null;
  amazonMinAllowedCents: number | null;
  amazonMaxAllowedCents: number | null;
}

export type SubmitResult =
  | { status: 'SKIPPED'; reason: string }
  | { status: 'VETOED'; veto: string; detail: string }
  | { status: 'ACCEPTED' | 'INVALID' | 'ERROR' | 'PREVIEWED'; mode: 'DRY_RUN' | 'LIVE'; message: string };

@Injectable()
export class PriceWriterService {
  private readonly logger = new Logger(PriceWriterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly control: RepricingControlService,
  ) {}

  async submit(input: SubmitInput): Promise<SubmitResult> {
    // Runtime controls (DB) + the env kill switch as an extra hard stop.
    const ctl = await this.control.get();
    const killed = ctl.killSwitchEngaged || envKillSwitch();
    const liveWrites = ctl.liveWritesEnabled;

    // 1. Write mode — kill switch / LIVE gate / master switch (all default to no real write).
    const mode = resolveWriteMode({ automationState: input.automationState, liveWritesEnabled: liveWrites, killSwitchEngaged: killed });
    if (mode === 'SKIP') {
      await this.recordVerdict(input.decisionId, { ok: false, veto: 'WRITE_SKIPPED' }, 'SKIPPED');
      return { status: 'SKIPPED', reason: killed ? 'kill switch engaged' : `state=${input.automationState}` };
    }

    // 2. Safety layer (§6.3) — the boring, exception-free final check.
    const verdict = checkSafety({
      priceCents: input.intendedPriceCents,
      currency: input.currency,
      marketplaceId: input.marketplaceId,
      breakevenCents: input.breakevenCents,
      currentPriceCents: input.currentPriceCents,
      maxStepPct: REPRICING_DEFAULTS.maxStepPctHard,
      automationState: input.automationState,
      killSwitchEngaged: killed,
    });
    if (!verdict.ok) {
      await this.recordVerdict(input.decisionId, verdict, 'VETOED');
      this.logger.warn(`Safety vetoed ${input.sku}@${input.marketplaceId}: ${verdict.veto} (${verdict.detail})`);
      return { status: 'VETOED', veto: verdict.veto, detail: verdict.detail };
    }

    // 3. Resolve the Amazon integration and submit (dry-run unless mode === LIVE).
    const integrationId = await this.resolveIntegrationId(input.marketplaceId);
    if (!integrationId) {
      await this.recordVerdict(input.decisionId, verdict, 'ERROR');
      return { status: 'ERROR', mode: mode === 'LIVE' ? 'LIVE' : 'DRY_RUN', message: 'no Amazon integration for marketplace' };
    }

    const dryRun = mode === 'DRY_RUN';
    const res = await this.integrations.patchListingsPrice(
      integrationId,
      input.sku,
      input.intendedPriceCents / 100,
      input.currency,
      { minAmount: input.amazonMinAllowedCents != null ? input.amazonMinAllowedCents / 100 : null, maxAmount: input.amazonMaxAllowedCents != null ? input.amazonMaxAllowedCents / 100 : null },
      dryRun,
    );

    const submissionStatus = res.ok ? (dryRun ? 'PREVIEWED' : 'ACCEPTED') : res.status;
    await this.prisma.repricingDecision.update({
      where: { id: input.decisionId },
      data: { safetyVerdict: verdict as unknown as Prisma.InputJsonValue, submissionStatus },
    });

    // On a real accepted write, advance the SKU's submission state (never in dry-run).
    if (res.ok && !dryRun) {
      await this.prisma.repricingSkuPricing.update({
        where: { id: input.skuPricingId },
        data: { lastSubmittedPriceCents: input.intendedPriceCents, lastSubmissionAt: new Date(), lastSubmissionStatus: 'ACCEPTED', currentPriceCents: input.intendedPriceCents },
      });
    }

    return { status: res.ok ? (dryRun ? 'PREVIEWED' : 'ACCEPTED') : (res.status as 'INVALID' | 'ERROR'), mode: dryRun ? 'DRY_RUN' : 'LIVE', message: res.message };
  }

  private async recordVerdict(decisionId: string, verdict: unknown, submissionStatus: string): Promise<void> {
    await this.prisma.repricingDecision.update({
      where: { id: decisionId },
      data: { safetyVerdict: verdict as Prisma.InputJsonValue, submissionStatus },
    });
  }

  private async resolveIntegrationId(marketplaceId: string): Promise<string | null> {
    const iso = MARKETPLACE_TO_ISO[marketplaceId] ?? Object.keys(ISO_TO_MARKETPLACE).find((k) => ISO_TO_MARKETPLACE[k] === marketplaceId);
    if (!iso) return null;
    const integration = await this.prisma.channelIntegration.findFirst({
      where: { channelType: 'amazon', marketplace: iso, deletedAt: null },
      select: { id: true },
    });
    return integration?.id ?? null;
  }
}
