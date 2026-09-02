import { describe, expect, it } from 'vitest';
import { AmazonListingService } from './amazon-listing.service';

/**
 * The decision that sits in front of every PUT: is there already a listing under this SKU, and if
 * so what does Amazon hold that our plan does not?
 *
 * Only the read and the branching are exercised here — no Prisma, no network. The merge itself is
 * pinned in put-replaces-listing.spec.ts against the live 4B-DEH-S320BT attributes.
 */

const built = {
  sku: '4B-DEH-S320BT',
  productType: 'PRODUCT',
  attributes: {
    purchasable_offer: [{ marketplace_id: 'A1F83G8C2ARO7P', currency: 'GBP' }],
    fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: 5 }],
  } as Record<string, unknown>,
};

/** Stands in for IntegrationsService.getAmazonListingState, which is all this path calls. */
const serviceReading = (state: Record<string, unknown>) => {
  const calls: string[] = [];
  const svc = new AmazonListingService(
    null as any,
    { getAmazonListingState: async (_id: string, sku: string) => (calls.push(sku), state) } as any,
    null as any,
  );
  return { payloadForPut: (svc as any).payloadForPut.bind(svc), calls };
};

describe('the payload for a PUT', () => {
  it('merges over what Amazon holds when the SKU already exists', async () => {
    const { payloadForPut, calls } = serviceReading({
      ok: true,
      exists: true,
      productType: 'DEHUMIDIFIER',
      attributes: {
        merchant_shipping_group: [{ marketplace_id: 'A1F83G8C2ARO7P', value: 'legacy-template-id' }],
        fulfillment_availability: [
          { fulfillment_channel_code: 'DEFAULT', quantity: 3 },
          { fulfillment_channel_code: 'DEFAULT_SA', quantity: 1 },
        ],
      },
    });

    const payload = await payloadForPut('int-1', built);
    expect(calls).toEqual(['4B-DEH-S320BT']);
    expect(payload.ok).toBe(true);
    expect(payload.existing).toBe(true);
    expect(payload.attributes.merchant_shipping_group).toBeDefined();
    expect(payload.carriedForward).toEqual(['merchant_shipping_group']);
    expect(payload.carriedFulfilmentChannels).toEqual(['DEFAULT_SA']);
    // Amazon's product type, not the plan's PRODUCT. The product type decides which attributes are
    // valid at all, so sending ours would re-categorise the item and invalidate the very attributes
    // just carried forward.
    expect(payload.productType).toBe('DEHUMIDIFIER');
  });

  it('falls back to the plan when the live listing reports no product type', async () => {
    const { payloadForPut } = serviceReading({ ok: true, exists: true, productType: null, attributes: {} });

    const payload = await payloadForPut('int-1', built);
    expect(payload.productType).toBe('PRODUCT');
  });

  it('sends the plan alone for a brand-new listing, which is the behaviour that was always right', async () => {
    const { payloadForPut } = serviceReading({ ok: true, exists: false, status: 404 });

    const payload = await payloadForPut('int-1', built);
    expect(payload.ok).toBe(true);
    expect(payload.existing).toBe(false);
    expect(payload.attributes).toEqual(built.attributes);
    // Nothing on Amazon to take a product type from: the plan decides where a new listing goes.
    expect(payload.productType).toBe('PRODUCT');
    expect(payload.carriedForward).toEqual([]);
  });

  it('refuses to write when it cannot read what it would be replacing', async () => {
    // Fails closed on purpose. A PUT built without the live attributes is precisely the fault this
    // guards against, and a throttled or failed read is no reason to risk stripping a live listing.
    const { payloadForPut } = serviceReading({ ok: false, exists: false, status: 429, message: 'QuotaExceeded' });

    const payload = await payloadForPut('int-1', built);
    expect(payload.ok).toBe(false);
    expect(payload.message).toContain('4B-DEH-S320BT');
    expect(payload.message).toContain('QuotaExceeded');
    expect(payload.message).toContain('Nothing was sent to Amazon.');
  });

  it('treats an existing listing with no attributes returned as nothing to carry', async () => {
    const { payloadForPut } = serviceReading({ ok: true, exists: true });

    const payload = await payloadForPut('int-1', built);
    expect(payload.ok).toBe(true);
    expect(payload.existing).toBe(true);
    expect(payload.attributes).toEqual(built.attributes);
    expect(payload.carriedForward).toEqual([]);
  });
});
