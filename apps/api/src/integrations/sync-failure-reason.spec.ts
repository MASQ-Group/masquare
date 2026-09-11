import { describe, expect, it } from 'vitest';
import { syncFailureReason } from './sync-failure-reason';

/** The real thing, copied from the production log of 11 Sep — the defect this was built for. */
const prismaUnknownArgument = `
Invalid \`prisma.salesTransactionItem.createMany()\` invocation:

{
  data: [
    {
      sku: "RE-MB3000",
      quantity: 1,
      netSalesAmount: 39.32,
      vatAmount: 7.87,
      salesTaxAmount: 7.87,
      channelReportedTaxCollection: true,
      productId: "8c7a3b4d-8692-47a0-bf8a-a9e89171711d",
      transactionId: "aadb2bb5-c241-4de1-9da6-38c2eeabea2e"
    }
  ]
}

Unknown argument \`channelReportedTaxCollection\`. Available options are marked with ?.`;

describe('syncFailureReason', () => {
  /**
   * The point of the whole exercise. Prisma buries the diagnosis under the rejected payload, so
   * the first line ("Invalid invocation") says only that something failed. The last line names
   * the field — which is the entire answer, and what nobody could see for a day.
   */
  it('pulls the diagnosis out from under a Prisma payload dump', () => {
    const r = syncFailureReason(new Error(prismaUnknownArgument));
    expect(r).toContain('Unknown argument `channelReportedTaxCollection`');
  });

  /** And says which write it was, since "unknown argument" alone does not locate it. */
  it('names the failing operation alongside the diagnosis', () => {
    expect(syncFailureReason(new Error(prismaUnknownArgument))).toContain('salesTransactionItem.createMany()');
  });

  it('drops the payload rather than storing forty lines of it', () => {
    const r = syncFailureReason(new Error(prismaUnknownArgument));
    expect(r).not.toContain('RE-MB3000');
    expect(r).not.toContain('transactionId');
    expect(r.length).toBeLessThanOrEqual(300);
  });

  /** An ordinary error states its case first; taking the last line would mangle it. */
  it('takes the first line of an ordinary error', () => {
    expect(syncFailureReason(new Error('Set the target sales channel first.')))
      .toBe('Set the target sales channel first.');
    expect(syncFailureReason(new Error('Line 1 is the reason.\nLine 2 is a stack hint.')))
      .toBe('Line 1 is the reason.');
  });

  /**
   * The trap that cost me an hour: `e?.message ?? e` rendered as an empty string, and an empty
   * reason reads as "no reason was given" rather than "the reason did not survive". Never blank.
   */
  it('never returns an empty string', () => {
    for (const thrown of [new Error(''), {}, null, undefined, '', { message: '' }, { message: '\n\n' }]) {
      const r = syncFailureReason(thrown);
      expect(r.trim().length).toBeGreaterThan(0);
    }
  });

  it('names the error type when there is no message to give', () => {
    expect(syncFailureReason(new TypeError(''))).toContain('TypeError');
  });

  /** Whatever the channel or a library throws, this runs on every failed order and must not add one. */
  it('survives anything at all', () => {
    for (const thrown of [42, [], Symbol('x'), new Map(), { message: { nested: true } }, () => {}]) {
      expect(() => syncFailureReason(thrown)).not.toThrow();
      expect(typeof syncFailureReason(thrown)).toBe('string');
    }
  });

  it('caps a runaway message', () => {
    expect(syncFailureReason(new Error('x'.repeat(5000))).length).toBeLessThanOrEqual(300);
  });

  it('reads a plain string as the reason', () => {
    expect(syncFailureReason('Amazon returned 503')).toBe('Amazon returned 503');
  });

  /** A Prisma constraint failure — the other shape these take in practice. */
  it('handles a constraint failure', () => {
    const e: any = new Error('Invalid `prisma.salesTransaction.create()` invocation:\n\n{ data: { id: "x" } }\n\nUnique constraint failed on the fields: (`transactionRef`)');
    e.name = 'PrismaClientKnownRequestError';
    expect(syncFailureReason(e)).toContain('Unique constraint failed');
  });
});
