// Step 4 — emit only meaningful changes (spec §5.6). Epsilon skips sub-threshold churn (every
// price change we make fires ANY_OFFER_CHANGED for everyone, including us); cooldown throttles
// per-SKU submissions. PRICING_HEALTH and floor breaches override cooldown (safetyOverride). The
// safety layer (§6.3) is a separate final gate the writer calls after this. PURE.

export interface EmitParams {
  epsilonCents: number;
  epsilonPct: number;
  cooldownSeconds: number;
}

export interface EmitContext {
  newPriceCents: number;
  currentPriceCents: number | null;
  lastSubmissionAtMs: number | null;
  nowMs: number;
  /** PRICING_HEALTH / floor-breach events override the cooldown (§5.6). */
  safetyOverride?: boolean;
}

export type EmitDecision = { emit: true } | { emit: false; skip: 'EPSILON' | 'COOLDOWN' };

export function shouldEmit(ctx: EmitContext, p: EmitParams): EmitDecision {
  if (ctx.currentPriceCents != null) {
    const epsilon = Math.max(p.epsilonCents, Math.round(p.epsilonPct * ctx.currentPriceCents));
    if (Math.abs(ctx.newPriceCents - ctx.currentPriceCents) < epsilon) {
      return { emit: false, skip: 'EPSILON' };
    }
  }
  if (!ctx.safetyOverride && ctx.lastSubmissionAtMs != null) {
    if (ctx.nowMs - ctx.lastSubmissionAtMs < p.cooldownSeconds * 1000) {
      return { emit: false, skip: 'COOLDOWN' };
    }
  }
  return { emit: true };
}
