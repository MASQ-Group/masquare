import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { isSkuInUseRejection } from './sku-collision';

/**
 * A refused SKU has to survive being thrown.
 *
 * Amazon reports "SKU already exists in other Amazon marketplace(s)", and submit() throws this when
 * the refusal is final. Thrown as a plain sentence, the alternative name computed a line later went
 * with it — so a bulk run could report the refusal and never offer the fix, and the only way out
 * was to leave for the single-channel flow and come back.
 *
 * Note the "final": a lone SKU-in-use error at VALIDATION no longer reaches here. See
 * validation-gate — the real submit is attempted first, because validation refuses names that
 * Seller Central accepts, and only a refusal from the real submit produces this exception. The
 * shape below is unchanged; what changed is how sure we are before using it.
 *
 * These pin the two halves of the fix: the exception still reads the same to anything that only
 * wants a message, and it now carries the parts a caller needs to act.
 */
describe('the refusal a bulk run has to be able to act on', () => {
  const refusal = () =>
    new BadRequestException({
      message: 'Amazon rejected the offer in validation: SKU IT33136 already exists in other Amazon marketplace(s).',
      sku: 'IT33136',
      skuInUse: true,
      skuSuggestion: 'IT33136-AU',
    });

  it('still reads as a message to anything that only wants one', () => {
    // Nest takes an exception's `.message` from a `message` property on the payload. Every existing
    // reader — logs, the single-channel screen, the per-row failure line — is unaffected.
    expect(refusal().message).toMatch(/already exists in other Amazon marketplace/);
  });

  it('carries the refused SKU and one Amazon would take', () => {
    const payload = refusal().getResponse() as { sku: string; skuInUse: boolean; skuSuggestion: string };
    expect(payload.skuInUse).toBe(true);
    expect(payload.sku).toBe('IT33136');
    expect(payload.skuSuggestion).toBe('IT33136-AU');
  });

  it('is reachable through the same shape the bulk runner reads', () => {
    // How listEverywhere gets at it: getResponse() where the thrown thing has one, null otherwise.
    const e: unknown = refusal();
    const payload = (typeof (e as { getResponse?: () => unknown })?.getResponse === 'function'
      ? (e as { getResponse: () => unknown }).getResponse()
      : null) as { skuInUse?: boolean } | null;
    expect(payload?.skuInUse).toBe(true);
  });

  it('reads nothing from an ordinary error, rather than throwing over it', () => {
    // A network failure is not a SKU problem, and the reader must not fall over trying to ask.
    const e: unknown = new Error('socket hang up');
    const payload = (typeof (e as { getResponse?: () => unknown })?.getResponse === 'function'
      ? (e as { getResponse: () => unknown }).getResponse()
      : null) as { skuInUse?: boolean } | null;
    expect(payload).toBeNull();
  });
});

describe('what counts as a refused SKU in the first place', () => {
  it('recognises Amazon code 100398', () => {
    expect(isSkuInUseRejection([{ code: '100398', message: 'anything' }])).toBe(true);
  });

  it('recognises the wording when the code is absent', () => {
    expect(isSkuInUseRejection([{ message: 'Use a new SKU and resubmit your listing.' }])).toBe(true);
  });

  it('offers nothing for any other rejection', () => {
    // A missing attribute, a gated brand, a bad price. Suggesting a new SKU for those would be
    // noise dressed as help, and renaming a SKU is permanent.
    expect(isSkuInUseRejection([{ code: '4000001', message: 'Missing attribute: item_weight' }])).toBe(false);
    expect(isSkuInUseRejection([{ message: 'You are not approved to list this brand' }])).toBe(false);
    expect(isSkuInUseRejection([])).toBe(false);
  });
});
