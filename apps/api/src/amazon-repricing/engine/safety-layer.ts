import { AutomationState } from './types';

// The safety layer (spec §6.3) — a separate, deliberately BORING module the price-writer calls
// LAST, after all strategy logic. It has no strategy knowledge and no exceptions: breakeven,
// step-size, kill-switch, currency sanity, and automationState.
//
// MAP is deliberately not among them. The MAP on a product card is an informational local-market
// retail price and says nothing about what a marketplace listing may be priced at; a channel
// listing is bounded by its floor and its max, and nothing else. If it vetoes, the decision
// record says exactly why. This is the third of the triple-enforced invariants (engine clamp →
// safety layer → Amazon min/max backstop). PURE.

export interface SafetyContext {
  priceCents: number;
  currency: string;
  marketplaceId: string;
  breakevenCents: number;
  currentPriceCents?: number | null;
  /** Max single-step deviation as a fraction (§9-#12, default 0.15). */
  maxStepPct: number;
  automationState: AutomationState;
  /** Global or per-marketplace kill switch engaged (§6.4). */
  killSwitchEngaged?: boolean;
}

export type SafetyVerdict =
  | { ok: true }
  | {
      ok: false;
      veto:
        | 'BELOW_BREAKEVEN'
        | 'STEP_TOO_LARGE'
        | 'KILL_SWITCH'
        | 'CURRENCY_MISMATCH'
        | 'STATE_NOT_WRITABLE';
      detail: string;
    };

/** Expected listing currency per marketplace — all three EU stores are EUR. */
const MARKETPLACE_CURRENCY: Record<string, string> = {
  A1PA6795UKMFR9: 'EUR', // DE
  A13V1IB3VIYZZH: 'EUR', // FR
  A1RKKUPIHCS9HS: 'EUR', // ES
};

export function checkSafety(ctx: SafetyContext): SafetyVerdict {
  // Kill switch and writable-state gates first — a KILLED SKU or an engaged switch never writes.
  if (ctx.killSwitchEngaged) {
    return { ok: false, veto: 'KILL_SWITCH', detail: 'kill switch engaged' };
  }
  if (ctx.automationState !== 'LIVE') {
    return {
      ok: false,
      veto: 'STATE_NOT_WRITABLE',
      detail: `automationState=${ctx.automationState} (only LIVE writes)`,
    };
  }

  // Never below breakeven — even for a manually entered price flowing through the writer (§6.1).
  if (ctx.priceCents < ctx.breakevenCents) {
    return { ok: false, veto: 'BELOW_BREAKEVEN', detail: `${ctx.priceCents} < breakeven ${ctx.breakevenCents}` };
  }

  // Step-size guard — never move more than maxStepPct in one submission (suppression avoidance, §1.5).
  if (ctx.currentPriceCents != null && ctx.currentPriceCents > 0) {
    const step = Math.abs(ctx.priceCents - ctx.currentPriceCents) / ctx.currentPriceCents;
    if (step > ctx.maxStepPct) {
      return {
        ok: false,
        veto: 'STEP_TOO_LARGE',
        detail: `step ${(step * 100).toFixed(1)}% > ${(ctx.maxStepPct * 100).toFixed(1)}%`,
      };
    }
  }

  // Marketplace sanity — currency must match the marketplace.
  const expected = MARKETPLACE_CURRENCY[ctx.marketplaceId];
  if (expected && ctx.currency !== expected) {
    return {
      ok: false,
      veto: 'CURRENCY_MISMATCH',
      detail: `${ctx.currency} != ${expected} for ${ctx.marketplaceId}`,
    };
  }

  return { ok: true };
}
