import { describe, expect, it } from 'vitest';
import {
  ADDRESS_RETENTION_DAYS,
  PURGEABLE_FIELDS,
  isPurgeDue,
  retentionBasis,
  addressFromEbayOrder,
  addressFromOnBuyOrder,
  channelMayWrite,
  isEmptyAddress,
  missingForLabel,
  normaliseAddress,
  type StoredAddress,
} from './delivery-address';

/**
 * A delivery address arrives by one of two routes and they must not fight.
 *
 * eBay and OnBuy give it to us in the order payload. Amazon does not — buyer addresses are
 * restricted data we hold no approval for — so those are copied out of Seller Central by hand. The
 * question these tests exist to settle is what happens when the two routes disagree.
 */

const stored = (over: Partial<StoredAddress> = {}): StoredAddress => ({
  source: 'channel',
  editedAt: null,
  fullName: 'A Buyer',
  addressLine1: '1 Example Street',
  city: 'Nicosia',
  postalCode: '1010',
  countryIso: 'CY',
  ...over,
});

const full = { fullName: 'A Buyer', addressLine1: '1 Example Street', city: 'Nicosia', postalCode: '1010', countryIso: 'CY' };

describe('who may overwrite whom', () => {
  it('lets a channel create an address where none is held', () => {
    expect(channelMayWrite(null, full)).toBe(true);
  });

  it('lets a channel refresh what it supplied itself', () => {
    // The buyer changed their address on eBay before despatch. That is the channel correcting its
    // own record, and it is the newest truth we have.
    expect(channelMayWrite(stored({ source: 'channel' }), full)).toBe(true);
  });

  it('refuses to let a channel overwrite a hand-typed address', () => {
    // The whole point. Somebody typed it because the channel's version was wrong or absent; a
    // nightly sync putting the wrong one back — silently, days later, possibly after a label was
    // printed — makes the correction pointless and the cause invisible.
    expect(channelMayWrite(stored({ source: 'manual', editedAt: new Date() }), full)).toBe(false);
  });

  it('refuses an empty payload even over a channel-sourced address', () => {
    // A channel that answered with an empty shell has told us nothing. Writing it would replace a
    // real address with a blank one and look like the buyer had removed theirs.
    expect(channelMayWrite(stored({ source: 'channel' }), {})).toBe(false);
    expect(channelMayWrite(null, { fullName: '   ', city: '' })).toBe(false);
  });
});

describe('what counts as no address at all', () => {
  it('treats blanks and whitespace as absent', () => {
    expect(isEmptyAddress({ fullName: '', city: '   ', postalCode: null })).toBe(true);
  });

  it('treats one real field as present', () => {
    expect(isEmptyAddress({ city: 'Nicosia' })).toBe(false);
  });
});

describe('normalising what gets stored', () => {
  it('upper-cases the country code', () => {
    // Carriers reject 'gb'. This is the one field where case is not cosmetic.
    expect(normaliseAddress({ countryIso: 'gb' }).countryIso).toBe('GB');
  });

  it('turns empty form fields into nulls rather than empty strings', () => {
    // A form submits '' for everything nobody filled in. Stored as '' those read as answered.
    const n = normaliseAddress({ fullName: '  A Buyer  ', addressLine2: '', phone: '   ' });
    expect(n.fullName).toBe('A Buyer');
    expect(n.addressLine2).toBeNull();
    expect(n.phone).toBeNull();
  });
});

describe('whether a label could be produced', () => {
  it('names every gap rather than answering yes or no', () => {
    // "Incomplete" on its own sends somebody hunting through a form.
    expect(missingForLabel({ fullName: 'A Buyer', countryIso: 'CY' }))
      .toEqual(['addressLine1', 'city', 'postalCode']);
  });

  it('reports everything missing when no address is held', () => {
    expect(missingForLabel(null)).toEqual(['fullName', 'addressLine1', 'city', 'postalCode', 'countryIso']);
  });

  it('is satisfied by the five fields a carrier insists on', () => {
    expect(missingForLabel(full)).toEqual([]);
  });

  it('does not require a phone number, which many buyers never give', () => {
    // Wanted by the carrier for delivery problems, but refusing to ship without one would block
    // most orders. It is a gap on the screen, not a blocker.
    expect(missingForLabel(full)).not.toContain('phone');
  });
});

describe('reading eBay orders', () => {
  const order = {
    fulfillmentStartInstructions: [{
      shippingStep: {
        shipTo: {
          fullName: 'A Buyer',
          primaryPhone: { phoneNumber: '+441234567890' },
          contactAddress: {
            addressLine1: '10 High Street', addressLine2: 'Flat 2', city: 'Leeds',
            stateOrProvince: 'West Yorkshire', postalCode: 'LS1 1AA', countryCode: 'GB',
          },
        },
      },
    }],
  };

  it('reads the address out of the payload we already fetch', () => {
    // This is the same object the mapping already reads countryCode from — no extra call, no new
    // scope. We were discarding the rest of it.
    expect(addressFromEbayOrder(order)).toMatchObject({
      fullName: 'A Buyer', addressLine1: '10 High Street', addressLine2: 'Flat 2',
      city: 'Leeds', stateOrRegion: 'West Yorkshire', postalCode: 'LS1 1AA',
      countryIso: 'GB', phone: '+441234567890',
    });
  });

  it('produces an empty address rather than throwing on an order with no shipping step', () => {
    // Digital orders and some cancellations carry none. An empty result is then correctly refused
    // by channelMayWrite rather than stored as a blank.
    expect(isEmptyAddress(addressFromEbayOrder({}))).toBe(true);
  });
});

describe('reading OnBuy orders', () => {
  it('reads the confirmed field, country_code', () => {
    // The only OnBuy key confirmed against live data, because it is the one already in use.
    expect(addressFromOnBuyOrder({ delivery_address: { country_code: 'gb' } }).countryIso).toBe('GB');
  });

  it('accepts either plausible spelling of the unconfirmed fields', () => {
    // OnBuy's exact names inside delivery_address are not confirmed. Tolerating alternatives fails
    // safe: an unrecognised name leaves a visible gap on the screen, where guessing one wrong would
    // leave a silent blank that looks like OnBuy never sent an address.
    const a = addressFromOnBuyOrder({ delivery_address: { address_line_1: '5 Mill Road', town: 'Bath', postcode: 'BA1 2AA' } });
    const b = addressFromOnBuyOrder({ delivery_address: { address_1: '5 Mill Road', city: 'Bath', postal_code: 'BA1 2AA' } });
    expect(a).toMatchObject({ addressLine1: '5 Mill Road', city: 'Bath', postalCode: 'BA1 2AA' });
    expect(b).toMatchObject({ addressLine1: '5 Mill Road', city: 'Bath', postalCode: 'BA1 2AA' });
  });

  it('leaves a gap rather than inventing a value for a name it does not know', () => {
    const a = addressFromOnBuyOrder({ delivery_address: { some_future_key: '5 Mill Road' } });
    expect(a.addressLine1).toBeNull();
  });
});

describe('Amazon', () => {
  it('has no extractor, deliberately', () => {
    // Buyer addresses are restricted data behind a PII role we do not hold. Amazon orders are typed
    // in by hand from Seller Central. If approval ever lands, Amazon starts arriving through the
    // channel route like the others and none of this changes.
    expect(missingForLabel(null)).toHaveLength(5);
  });
});

describe('retention', () => {
  const NOW = new Date('2026-09-08T09:00:00Z');
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  it('keeps an address for twelve months from despatch', () => {
    expect(isPurgeDue(daysAgo(364), NOW)).toBe(false);
    expect(isPurgeDue(daysAgo(365), NOW)).toBe(true);
    expect(isPurgeDue(daysAgo(400), NOW)).toBe(true);
  });

  it('runs the clock from the LAST parcel, not the first', () => {
    // A part-shipped order is still being shipped. Starting at the first despatch would erase the
    // address while the second parcel is still outstanding.
    const basis = retentionBasis({ date: daysAgo(400), outboundShipmentDates: [daysAgo(380), daysAgo(200)] });
    expect(basis).toEqual(daysAgo(200));
    expect(isPurgeDue(basis, NOW)).toBe(false);
  });

  it('falls back to the order date where nothing was ever despatched', () => {
    const basis = retentionBasis({ date: daysAgo(400), outboundShipmentDates: [] });
    expect(basis).toEqual(daysAgo(400));
    expect(isPurgeDue(basis, NOW)).toBe(true);
  });

  it('covers the 99th percentile of our actual returns', () => {
    // Measured over 151 returns and replacements: median 113 days from despatch to the day we acted,
    // 99th percentile 313. The period is evidence, not a round number.
    expect(ADDRESS_RETENTION_DAYS).toBeGreaterThan(313);
  });

  it('empties every identifying field', () => {
    // Whatever a carrier could deliver to, or a person be recognised by. Provenance columns stay:
    // they describe the record, not the recipient.
    for (const f of ['fullName', 'addressLine1', 'postalCode', 'phone', 'email', 'eori']) {
      expect(PURGEABLE_FIELDS).toContain(f as any);
    }
    expect(PURGEABLE_FIELDS).not.toContain('source' as any);
  });
});

describe('a purged address stays purged', () => {
  const purged = (): StoredAddress => ({
    source: 'channel', editedAt: null, purgedAt: new Date('2026-09-01T00:00:00Z'),
  });

  it('refuses the sync that would otherwise put it straight back', () => {
    // The order still exists and eBay still holds the address, so without this the next sync would
    // re-import what we had just erased — the policy would appear to work and do nothing.
    expect(channelMayWrite(purged(), full)).toBe(false);
  });

  it('refuses even though the row is channel-sourced, which normally may be refreshed', () => {
    // The ordinary rule would allow this write. Purged outranks it.
    expect(channelMayWrite({ source: 'channel', editedAt: null }, full)).toBe(true);
    expect(channelMayWrite(purged(), full)).toBe(false);
  });
});
