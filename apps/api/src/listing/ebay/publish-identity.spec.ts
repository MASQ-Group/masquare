import { describe, expect, it } from 'vitest';
import { publishIdentity } from './publish-identity';

const listed = (channelSku: string, externalListingId = '267438735742') =>
  ({ status: 'LISTED', channelSku, externalListingId });

describe('a product not yet on eBay', () => {
  it('is created under its own SKU, punctuation and all', () => {
    expect(publishIdentity({ mainSku: 'LE-83306', plan: null, existing: [] }))
      .toEqual({ action: 'create', sku: 'LE-83306' });
  });

  it('is created even with a draft plan in hand', () => {
    const plan = { status: 'DRAFT', channelSku: null, externalListingId: null };
    expect(publishIdentity({ mainSku: 'LE-83306', plan, existing: [] }).action).toBe('create');
  });
});

describe('a listing this platform published and recorded', () => {
  it('is updated in place, under the SKU it was made with', () => {
    const r = publishIdentity({ mainSku: 'LE-83306', plan: listed('LE-83306'), existing: [{ channelSku: 'LE-83306', itemId: '267438735742' }] });
    expect(r).toEqual({ action: 'update', sku: 'LE-83306', itemId: '267438735742', adopted: false });
  });

  it('keeps the recorded SKU even if the product SKU has since changed', () => {
    // Renaming the product must not orphan its listing and start a second one.
    const r = publishIdentity({ mainSku: 'LE-83306-B', plan: listed('LE-83306'), existing: [] });
    expect(r).toMatchObject({ action: 'update', sku: 'LE-83306' });
  });
});

describe('one of ours published with a stripped SKU', () => {
  it('is adopted and updated rather than duplicated under the new SKU', () => {
    // Published as LE83306 before publishes were recorded. Sending LE-83306 now would miss the offer
    // eBay holds and create a second listing beside it.
    const r = publishIdentity({ mainSku: 'LE-83306', plan: null, existing: [{ channelSku: 'LE83306', itemId: '267221837327' }] });
    expect(r).toEqual({ action: 'update', sku: 'LE83306', itemId: '267221837327', adopted: true });
  });

  it('is only adopted when it is the one listing there — two is not a shape our code made', () => {
    const r = publishIdentity({
      mainSku: 'LE-83306',
      plan: null,
      existing: [{ channelSku: 'LE83306', itemId: '1' }, { channelSku: 'LE-83306', itemId: '2' }],
    });
    expect(r.action).toBe('refuse');
  });
});

describe('a product already on eBay some other way', () => {
  it('is refused rather than listed a second time', () => {
    // Made by hand or through the Trading API: invisible to the Inventory API, so publishing would
    // create a duplicate. Same SKU makes no difference — it is still a different listing.
    const r = publishIdentity({ mainSku: 'RE-PG5000', plan: null, existing: [{ channelSku: 'RE-PG5000', itemId: '267221837327' }] });
    expect(r.action).toBe('refuse');
    expect((r as { reason: string }).reason).toContain('267221837327');
    expect((r as { reason: string }).reason).toContain('second listing');
  });

  it('does not adopt a SKU that merely has no punctuation to strip', () => {
    // A product whose own SKU is already letters and digits: an existing listing under it is not
    // evidence of our old stripping, so it is not ours to take over.
    const r = publishIdentity({ mainSku: 'ABC123', plan: null, existing: [{ channelSku: 'ABC123', itemId: '9' }] });
    expect(r.action).toBe('refuse');
  });

  it('names a few and counts the rest, so the message stays readable', () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({ channelSku: `X-${i}`, itemId: String(100 + i) }));
    const reason = (publishIdentity({ mainSku: 'X-0', plan: null, existing }) as { reason: string }).reason;
    expect(reason).toContain('and 2 more');
  });

  it('refuses a draft plan too — a plan that never listed does not own what is there', () => {
    const plan = { status: 'DRAFT', channelSku: 'RE-PG5000', externalListingId: null };
    const r = publishIdentity({ mainSku: 'RE-PG5000', plan, existing: [{ channelSku: 'RE-PG5000', itemId: '1' }] });
    expect(r.action).toBe('refuse');
  });
});
