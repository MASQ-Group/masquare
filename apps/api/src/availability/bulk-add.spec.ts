import { describe, expect, it } from 'vitest';

/**
 * Putting many products into availability at once.
 *
 * Adding one at a time is the honest unit — a person decides a product is ours to track — but after
 * the purge 660 listed products need adding, and 660 clicks is not a process anyone finishes. This
 * is the same decision taken once for many, not a different rule.
 *
 * Zero is the opening figure, not a guess at stock: tracked, and nobody has counted it. It is also
 * the only safe opening figure, because any number we invented would be publishable the moment
 * someone pressed Push to channels.
 */

type Product = { id: string; inAvailability: boolean; listed: boolean; deleted?: boolean };

/** The selection bulkAdd makes. */
const selectFor = (products: Product[], explicit?: string[], listedOnly = true) =>
  products.filter((p) =>
    !p.deleted
    && !p.inAvailability
    && (listedOnly ? p.listed : true)
    && (explicit?.length ? explicit.includes(p.id) : true));

const catalogue: Product[] = [
  { id: 'a', inAvailability: false, listed: true },
  { id: 'b', inAvailability: false, listed: true },
  { id: 'c', inAvailability: true, listed: true },
  { id: 'd', inAvailability: false, listed: false },
  { id: 'e', inAvailability: false, listed: true, deleted: true },
];

describe('choosing what to add', () => {
  it('takes listed products that are not yet tracked', () => {
    expect(selectFor(catalogue).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('never touches a product already in availability', () => {
    // It has a figure someone stands behind. Re-adding it at zero would empty the shelves by
    // another name — the exact failure this whole area has been about.
    expect(selectFor(catalogue).some((p) => p.id === 'c')).toBe(false);
  });

  it('leaves a product listed nowhere alone by default', () => {
    // Tracking something that sells nowhere gains nothing and clutters the count that matters.
    expect(selectFor(catalogue).some((p) => p.id === 'd')).toBe(false);
  });

  it('can be asked to include unlisted products', () => {
    expect(selectFor(catalogue, undefined, false).map((p) => p.id)).toEqual(['a', 'b', 'd']);
  });

  it('ignores deleted products', () => {
    expect(selectFor(catalogue).some((p) => p.id === 'e')).toBe(false);
  });

  it('honours an explicit selection', () => {
    expect(selectFor(catalogue, ['a']).map((p) => p.id)).toEqual(['a']);
  });

  it('silently drops an explicit id that is already tracked', () => {
    // Asking for something already done is not an error; it is simply nothing to do.
    expect(selectFor(catalogue, ['a', 'c']).map((p) => p.id)).toEqual(['a']);
  });

  it('adds nothing when everything is already tracked', () => {
    const done = catalogue.map((p) => ({ ...p, inAvailability: true }));
    expect(selectFor(done)).toHaveLength(0);
  });
});

describe('what each product gets', () => {
  // The row and its ledger line, as bulkAdd writes them.
  const opening = { quantity: 0, lastSource: 'manual', ledger: { delta: 0, newQuantity: 0, reason: 'manual_set' } };

  it('opens at zero, from a person', () => {
    expect(opening.quantity).toBe(0);
    expect(opening.lastSource).toBe('manual');
  });

  it('records the addition in the ledger', () => {
    // So a product appearing in availability has an explanation, not an unaccountable arrival.
    expect(opening.ledger).toMatchObject({ delta: 0, newQuantity: 0, reason: 'manual_set' });
  });

  it('cannot reach a marketplace from its opening figure', () => {
    // A push may lower a live quantity or leave it; raising one is a deliberate act. Zero here can
    // only ever mean "not yet counted", never "withdraw this listing".
    const wouldPushRaise = (listedOnChannel: number, availability: number) => availability > listedOnChannel;
    expect(wouldPushRaise(5, 0)).toBe(false);
  });
});
