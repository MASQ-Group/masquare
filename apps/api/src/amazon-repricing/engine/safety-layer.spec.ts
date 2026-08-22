import { describe, it, expect } from 'vitest';
import { checkSafety, SafetyContext } from './safety-layer';

function ctx(overrides: Partial<SafetyContext> = {}): SafetyContext {
  return {
    priceCents: 2000,
    currency: 'EUR',
    marketplaceId: 'A1PA6795UKMFR9',
    breakevenCents: 1500,
    mapCents: null,
    currentPriceCents: 1950,
    maxStepPct: 0.15,
    automationState: 'LIVE',
    killSwitchEngaged: false,
    ...overrides,
  };
}

describe('checkSafety', () => {
  it('passes a sane LIVE price', () => {
    expect(checkSafety(ctx())).toEqual({ ok: true });
  });

  it('vetoes a price below breakeven — the non-negotiable invariant', () => {
    const v = checkSafety(ctx({ priceCents: 1499 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.veto).toBe('BELOW_BREAKEVEN');
  });

  it('does not veto on MAP — a listing is bounded by its floor and max only', () => {
    const v = checkSafety(ctx({ priceCents: 1800, mapCents: 1900 } as any));
    expect(v.ok).toBe(true);
  });

  it('vetoes a step larger than maxStepPct', () => {
    const v = checkSafety(ctx({ priceCents: 2400, currentPriceCents: 2000 })); // +20% > 15%
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.veto).toBe('STEP_TOO_LARGE');
  });

  it('allows a step exactly at the limit', () => {
    expect(checkSafety(ctx({ priceCents: 2300, currentPriceCents: 2000 })).ok).toBe(true); // +15%
  });

  it('vetoes when the kill switch is engaged, before anything else', () => {
    const v = checkSafety(ctx({ killSwitchEngaged: true, priceCents: 1 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.veto).toBe('KILL_SWITCH');
  });

  it.each(['SHADOW', 'EXCLUDED', 'QUARANTINED', 'KILLED'] as const)(
    'vetoes writes when automationState is %s (only LIVE writes)',
    (state) => {
      const v = checkSafety(ctx({ automationState: state }));
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.veto).toBe('STATE_NOT_WRITABLE');
    },
  );

  it('vetoes a currency that does not match the marketplace', () => {
    const v = checkSafety(ctx({ currency: 'GBP' }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.veto).toBe('CURRENCY_MISMATCH');
  });

  it('skips the step check when there is no current price', () => {
    expect(checkSafety(ctx({ currentPriceCents: null, priceCents: 2000 })).ok).toBe(true);
  });
});
