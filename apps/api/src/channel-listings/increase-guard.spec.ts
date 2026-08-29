import { describe, expect, it } from 'vitest';

/**
 * A live quantity may only be RAISED by a person pressing Push to channels.
 *
 * The asymmetry is the point. Pushing a number down too eagerly costs a sale. Pushing one up
 * wrongly sells goods that do not exist, and the platform has already shown it will push a figure
 * nobody chose — in August a missing availability row defaulted to zero and emptied ~1,900 eBay
 * listings. The same machinery pointed the other way offers stock instead of withdrawing it.
 *
 * The case that would trip it daily: an order is cancelled before shipment, availability restores
 * the units, and the sell-through auto-push carries that increase to every marketplace without
 * anyone deciding to. So the guard sits at the push itself, not at its callers, where a new caller
 * cannot forget it.
 */

type Listing = { channelSku: string; listedQuantity: number | null };
type Outcome = { pushed: boolean; target: number | null; message?: string };

/** The decision pushAvailability makes per listing. */
function decide(l: Listing, target: number | undefined, allowIncrease: boolean): Outcome {
  // No availability row: we do not know, and the honest answer to not knowing is silence.
  if (target === undefined) return { pushed: false, target: null, message: 'No availability record' };
  if (!allowIncrease && l.listedQuantity != null && target > l.listedQuantity) {
    return { pushed: false, target, message: 'Increases are only sent from Push to channels.' };
  }
  return { pushed: true, target };
}

describe('an automatic run', () => {
  const auto = (l: Listing, t?: number) => decide(l, t, false);

  it('may lower a quantity', () => {
    // Sell-through: five listed, one sold, four remain.
    expect(auto({ channelSku: 'A', listedQuantity: 5 }, 4)).toMatchObject({ pushed: true, target: 4 });
  });

  it('may take a quantity to zero', () => {
    // Out of stock is a real state and worth sending.
    expect(auto({ channelSku: 'A', listedQuantity: 3 }, 0)).toMatchObject({ pushed: true, target: 0 });
  });

  it('refuses to raise one', () => {
    // The cancellation-restore case. Availability went back up; the marketplace must not.
    const r = auto({ channelSku: 'A', listedQuantity: 4 }, 5);
    expect(r.pushed).toBe(false);
    expect(r.message).toMatch(/Push to channels/);
  });

  it('still sends an unchanged figure', () => {
    // Equal is not an increase — re-asserting the same number is harmless and keeps drift closed.
    expect(auto({ channelSku: 'A', listedQuantity: 4 }, 4).pushed).toBe(true);
  });

  it('sends nothing at all without an availability row', () => {
    // Never a zero, never a guess.
    expect(auto({ channelSku: 'A', listedQuantity: 9 }, undefined)).toMatchObject({ pushed: false, target: null });
  });

  it('allows a first push where the channel quantity is unknown', () => {
    // A null listed quantity is not a lower bound, so there is nothing to compare against. The
    // blast-radius guard and the zeroing cap still apply upstream.
    expect(auto({ channelSku: 'A', listedQuantity: null }, 7).pushed).toBe(true);
  });
});

describe('a person pressing Push to channels', () => {
  const manual = (l: Listing, t?: number) => decide(l, t, true);

  it('may raise a quantity', () => {
    expect(manual({ channelSku: 'A', listedQuantity: 4 }, 5)).toMatchObject({ pushed: true, target: 5 });
  });

  it('may raise from zero, which is how a product goes back on sale', () => {
    expect(manual({ channelSku: 'A', listedQuantity: 0 }, 12).pushed).toBe(true);
  });

  it('is still refused where there is no availability row', () => {
    // Deliberate or not, a product outside availability is not ours to publish.
    expect(manual({ channelSku: 'A', listedQuantity: 0 }, undefined).pushed).toBe(false);
  });
});
