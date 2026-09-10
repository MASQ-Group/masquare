import { describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from './availability.service';

/**
 * Setting a quantity must answer with what was stored, not with what was there before.
 *
 * `setQuantity` used to return `this.get(productId)` from INSIDE its own transaction. `get` reads
 * through `this.prisma`, which is a different connection from the transaction's client, so it could
 * not see the uncommitted writes and answered with the pre-transaction state. Adding a product to
 * availability with a quantity of 3 wrote 3 and replied `quantity: null, lastSource: null` — the
 * write was right and the reply said it had not happened.
 *
 * Nothing about that is visible to a typecheck or a build. It only shows when the two connections
 * are modelled honestly, which is what this does: the transaction's writes are staged and become
 * visible to the outer client only once the callback resolves.
 */

function makePrisma() {
  /** What a reader outside the transaction can see. */
  const committed: { availability: any | null; ledger: any[] } = { availability: null, ledger: [] };
  /** Writes made through the transaction client, invisible until it commits. */
  let staged: { availability: any | null; ledger: any[] } = { availability: null, ledger: [] };

  const prisma: any = {
    product: {
      findFirst: vi.fn().mockImplementation(async () => ({
        id: 'p1', mainSku: 'MT-SPK7507B/00', title: 'A product',
        brand: null, vendor: null, productType: null,
        // The join a real read would do — and the crux: it sees only committed state.
        availability: committed.availability,
      })),
    },
    productAvailability: {
      findUnique: vi.fn().mockImplementation(async () => committed.availability),
    },
    availabilityLedger: {
      findMany: vi.fn().mockImplementation(async () => committed.ledger),
    },
    $transaction: vi.fn().mockImplementation(async (cb: any) => {
      staged = { availability: null, ledger: [] };
      const tx = {
        productAvailability: {
          upsert: vi.fn().mockImplementation(async ({ create, update }: any) => {
            staged.availability = committed.availability ? { ...committed.availability, ...update } : { ...create };
          }),
        },
        availabilityLedger: {
          create: vi.fn().mockImplementation(async ({ data }: any) => { staged.ledger.push(data); }),
        },
      };
      const result = await cb(tx);
      // Commit: only now is any of it visible to the outer connection.
      if (staged.availability) committed.availability = staged.availability;
      committed.ledger = [...staged.ledger, ...committed.ledger];
      return result;
    }),
  };
  return prisma;
}

describe('setQuantity', () => {
  it('returns the quantity it just stored, not the state before the write', async () => {
    const svc = new AvailabilityService(makePrisma());
    const row = await svc.setQuantity('p1', 3, 'first count', 'user-1');
    expect(row.quantity).toBe(3);
    expect(row.lastSource).toBe('manual');
  });

  it('returns the ledger entry it just wrote', async () => {
    const svc = new AvailabilityService(makePrisma());
    const row = await svc.setQuantity('p1', 3, 'first count', 'user-1');
    expect(row.ledger).toHaveLength(1);
    expect(row.ledger[0]).toMatchObject({ reason: 'manual_set', delta: 3, newQuantity: 3 });
  });

  /** The case the Availability page's own editor exercises: a row that already exists. */
  it('answers with the new figure when the product was already in availability', async () => {
    const prisma = makePrisma();
    const svc = new AvailabilityService(prisma);
    await svc.setQuantity('p1', 3, null, 'user-1');
    const row = await svc.setQuantity('p1', 7, null, 'user-1');
    expect(row.quantity).toBe(7);
    // Delta is measured from the committed figure, so a second write moves by 4 rather than 7.
    expect(row.ledger[0]).toMatchObject({ delta: 4, newQuantity: 7 });
  });
});
