import { describe, expect, it } from 'vitest';
import { planStateChange, type StateRow } from './automation-state';

const NOW = new Date('2026-09-16T12:00:00Z');
const FRESH = new Date('2026-09-20T00:00:00Z');
const SHADOW: StateRow = {
  automationState: 'SHADOW', exclusionReason: null, breakevenCents: 2000, strategyFloorCents: 2300,
  floorStaleAfter: FRESH, strategy: 'BUY_BOX',
};
const opts = { now: NOW, liveWritesEnabled: true };

describe('planStateChange — going live', () => {
  it('allows a shadow SKU with fresh floors', () => {
    expect(planStateChange(SHADOW, 'LIVE', opts)).toMatchObject({ ok: true, problems: [] });
  });

  it('refuses a SKU that is not in shadow', () => {
    expect(planStateChange({ ...SHADOW, automationState: 'EXCLUDED' }, 'LIVE', opts).problems[0]).toContain('Only a SKU in shadow');
    expect(planStateChange({ ...SHADOW, automationState: 'KILLED' }, 'LIVE', opts).ok).toBe(false);
  });

  it('refuses without floors, with a missing input, or on stale floors', () => {
    expect(planStateChange({ ...SHADOW, strategyFloorCents: null }, 'LIVE', opts).problems[0]).toContain('breakeven and floor');
    expect(planStateChange({ ...SHADOW, exclusionReason: 'COGS_MISSING' }, 'LIVE', opts).problems[0]).toContain('COGS_MISSING');
    expect(planStateChange({ ...SHADOW, floorStaleAfter: new Date('2026-09-15T00:00:00Z') }, 'LIVE', opts).problems[0]).toContain('stale');
  });

  /** Live with the platform switch off is legitimate — and must not look like it is pricing. */
  it('allows it with live writes off, and says nothing will reach Amazon', () => {
    const p = planStateChange(SHADOW, 'LIVE', { ...opts, liveWritesEnabled: false });
    expect(p.ok).toBe(true);
    expect(p.notes.join(' ')).toContain('switched off platform-wide');
  });

  it('warns that a Manual only SKU will still never price', () => {
    expect(planStateChange({ ...SHADOW, strategy: 'MANUAL_ONLY' }, 'LIVE', opts).notes.join(' ')).toContain('Manual only');
  });
});

describe('planStateChange — stopping', () => {
  it('always allows killing, from any state', () => {
    for (const s of ['LIVE', 'SHADOW', 'EXCLUDED', 'QUARANTINED']) {
      expect(planStateChange({ ...SHADOW, automationState: s }, 'KILLED', opts).ok).toBe(true);
    }
  });

  it('allows shadow from live and from killed', () => {
    expect(planStateChange({ ...SHADOW, automationState: 'LIVE' }, 'SHADOW', opts).ok).toBe(true);
    expect(planStateChange({ ...SHADOW, automationState: 'KILLED' }, 'SHADOW', opts).ok).toBe(true);
  });

  it('says when a SKU will not stay in shadow', () => {
    const p = planStateChange({ ...SHADOW, automationState: 'EXCLUDED', exclusionReason: 'FLOOR_STALE' }, 'SHADOW', opts);
    expect(p.ok).toBe(true);
    expect(p.notes[0]).toContain('back to excluded');
  });

  /** Quarantine has its own way back, so that the conflict is looked at. */
  it('sends a quarantined SKU to Resolve rather than to shadow', () => {
    expect(planStateChange({ ...SHADOW, automationState: 'QUARANTINED' }, 'SHADOW', opts).problems[0]).toContain('Resolve');
  });

  it('refuses a change to the state it is already in', () => {
    expect(planStateChange(SHADOW, 'SHADOW', opts).problems[0]).toContain('already');
  });
});
