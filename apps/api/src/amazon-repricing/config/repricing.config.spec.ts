import { describe, it, expect } from 'vitest';
import { ISO_TO_MARKETPLACE, MARKETPLACE_TO_ISO } from './repricing.config';

describe('marketplace ↔ ISO maps', () => {
  it('covers the three target marketplaces', () => {
    expect(MARKETPLACE_TO_ISO).toMatchObject({ A1PA6795UKMFR9: 'DE', A13V1IB3VIYZZH: 'FR', A1RKKUPIHCS9HS: 'ES' });
  });

  it('ISO_TO_MARKETPLACE is a faithful inverse', () => {
    for (const [mkt, iso] of Object.entries(MARKETPLACE_TO_ISO)) {
      expect(ISO_TO_MARKETPLACE[iso]).toBe(mkt);
    }
    expect(ISO_TO_MARKETPLACE).toMatchObject({ DE: 'A1PA6795UKMFR9', FR: 'A13V1IB3VIYZZH', ES: 'A1RKKUPIHCS9HS' });
  });
});
