import { describe, it, expect } from 'vitest';
import { resolveWriteMode } from './write-mode';

describe('resolveWriteMode', () => {
  it('LIVE only when the SKU is LIVE and live-writes are enabled', () => {
    expect(resolveWriteMode({ automationState: 'LIVE', liveWritesEnabled: true, killSwitchEngaged: false })).toBe('LIVE');
  });

  it('DRY_RUN for a LIVE SKU while the master switch is off (default safe state)', () => {
    expect(resolveWriteMode({ automationState: 'LIVE', liveWritesEnabled: false, killSwitchEngaged: false })).toBe('DRY_RUN');
  });

  it('SKIP when the kill switch is engaged, even for a LIVE SKU with writes enabled', () => {
    expect(resolveWriteMode({ automationState: 'LIVE', liveWritesEnabled: true, killSwitchEngaged: true })).toBe('SKIP');
  });

  it.each(['SHADOW', 'EXCLUDED', 'QUARANTINED', 'KILLED'] as const)('SKIP for non-LIVE state %s', (state) => {
    expect(resolveWriteMode({ automationState: state, liveWritesEnabled: true, killSwitchEngaged: false })).toBe('SKIP');
  });
});
