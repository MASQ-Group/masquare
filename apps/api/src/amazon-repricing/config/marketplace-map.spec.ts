import { describe, expect, it } from 'vitest';
import { MARKETPLACE_TO_ISO, ISO_TO_MARKETPLACE } from './repricing.config';
import { getConnector } from '../../integrations/connectors';

// The repricing marketplace map is DERIVED from the connector registry so onboarding can never
// silently skip a marketplace the platform supports (it once covered only DE/FR/ES, which dropped
// AU/JP/SG/UK/… as "unsupported"). These tests fail if the two ever drift apart again.

describe('marketplace map', () => {
  const registry = getConnector('amazon')!.marketplaces;

  it('covers every Amazon marketplace in the connector registry', () => {
    const registryIds = registry.map((m) => m.meta!.marketplaceId).filter(Boolean);
    expect(registryIds.length).toBeGreaterThan(20); // sanity: the registry is fully populated
    for (const id of registryIds) expect(MARKETPLACE_TO_ISO[id]).toBeDefined();
    expect(Object.keys(MARKETPLACE_TO_ISO)).toHaveLength(registryIds.length);
  });

  it('maps the marketplaces this seller actually trades on', () => {
    // Spot-check the ones that were previously skipped, including the FE region.
    expect(MARKETPLACE_TO_ISO.A39IBJ37TRP1C6).toBe('AU');
    expect(MARKETPLACE_TO_ISO.A1VC38T7YXB528).toBe('JP');
    expect(MARKETPLACE_TO_ISO.A19VAU5U5O7RUS).toBe('SG');
    expect(MARKETPLACE_TO_ISO.A1F83G8C2ARO7P).toBe('UK');
    expect(MARKETPLACE_TO_ISO.ATVPDKIKX0DER).toBe('US');
    // …and the original three still resolve.
    expect(MARKETPLACE_TO_ISO.A1PA6795UKMFR9).toBe('DE');
    expect(MARKETPLACE_TO_ISO.A13V1IB3VIYZZH).toBe('FR');
    expect(MARKETPLACE_TO_ISO.A1RKKUPIHCS9HS).toBe('ES');
  });

  it('is a lossless round trip (onboarding derives the id from the integration country)', () => {
    for (const [mkt, iso] of Object.entries(MARKETPLACE_TO_ISO)) {
      expect(ISO_TO_MARKETPLACE[iso]).toBe(mkt);
    }
  });
});
