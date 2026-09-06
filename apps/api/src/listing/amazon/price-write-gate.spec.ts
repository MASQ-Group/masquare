import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Three write gates, none of which can turn on another.
 *
 * The platform can change three different things on a marketplace, and they are not the same act:
 *
 *   listingLiveWrites          creating a listing that did not exist
 *   channelPriceWrites         a person changing ONE listing's price
 *   AMZ_REPRICING_LIVE_WRITES  the repricing engine changing prices in bulk, from automation
 *
 * They were asked to be separate for a reason: switching on a human editing one price should not
 * quietly switch on an engine that rewrites thousands, and neither should imply permission to
 * create listings. A shared flag is one careless toggle away from the 4 Aug incident, where a
 * push nobody meant to make emptied ~5,000 listings.
 *
 * Each also has an environment kill switch that overrules the setting, so a server can be made
 * incapable of an act regardless of who is clicking.
 */
const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('marketplace write gates stay independent', () => {
  const service = read('listing/amazon/amazon-listing.service.ts');

  it('reads its own setting and its own kill switch', () => {
    expect(service).toMatch(/CHANNEL_PRICE_WRITES === 'false'/);
    expect(service).toMatch(/channelPriceWrites/);
  });

  it('does not consult the listing-creation gate to decide a price write', () => {
    // The whole point: one function, one flag. Reading listingLiveWrites here would silently make
    // "create listings" mean "and change prices too".
    const fn = service.slice(service.indexOf('async priceWritesEnabled'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).not.toMatch(/listingLiveWrites/);
    expect(body).not.toMatch(/LISTING_LIVE_WRITES/);
    expect(body).not.toMatch(/REPRICING/);
  });

  it('does not consult the price gate to decide a listing write', () => {
    const fn = service.slice(service.indexOf('async liveWritesEnabled'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).not.toMatch(/channelPriceWrites/);
    expect(body).not.toMatch(/CHANNEL_PRICE_WRITES/);
  });

  it('leaves the repricing engine reading only its own switch', () => {
    const writer = read('amazon-repricing/writer/write-mode.ts');
    expect(writer).not.toMatch(/channelPriceWrites/);
    expect(writer).not.toMatch(/CHANNEL_PRICE_WRITES/);
  });

  it('needs the gate AND an explicit confirm before anything is sent', () => {
    // Two independent yeses. Either alone leaves it a validation run, the same shape as listing
    // creation — which is the one flow that has never sent something nobody asked for.
    expect(service).toMatch(/const dryRun = !\(live && opts\.confirm === true\)/);
  });

  it('records every attempt, sent or not', () => {
    // A price change is the kind of act somebody asks about a week later, and "did we send it?"
    // has to be answerable from the record rather than from memory.
    const fn = service.slice(service.indexOf('async updatePrice'));
    expect(fn.slice(0, fn.indexOf('\n  }\n'))).toMatch(/channelPush\.create/);
  });

  it('only writes our own price record after a real, accepted send', () => {
    // A dry run must not leave the platform believing the marketplace agrees with it.
    expect(service).toMatch(/if \(result\.ok && !dryRun\)/);
  });
});
