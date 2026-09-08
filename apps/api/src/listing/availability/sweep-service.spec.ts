import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilitySweepService } from './availability-sweep.service';

/**
 * The parts of the sweeper that decide whether to run at all, and what it writes when it does.
 *
 * The queue ordering is tested next door on pure functions; these are the rules that only exist
 * once a database and a clock are involved — the interval gate, the overlap guard, and the promise
 * that a failing marketplace still leaves a record.
 */

const SETTINGS_ROW = {
  id: 'settings-1',
  availabilitySweepEnabled: true,
  availabilitySweepBatchSize: 2,
  availabilitySweepIntervalMinutes: 120,
  availabilityRecheckDays: 30,
  availabilitySweepLastRunAt: null as Date | null,
};

function makePrisma(over: Partial<Record<string, any>> = {}) {
  const upserts: any[] = [];
  const prisma: any = {
    platformSettings: {
      findFirst: vi.fn().mockResolvedValue({ ...SETTINGS_ROW, ...(over.settings ?? {}) }),
      update: vi.fn().mockResolvedValue({}),
    },
    channelIntegration: {
      findMany: vi.fn().mockResolvedValue(
        over.integrations ?? [{ id: 'i1', targetCompanyId: 'c1', marketplace: 'ES' }],
      ),
    },
    product: { findMany: vi.fn().mockResolvedValue(over.products ?? [{ id: 'p1' }]) },
    productChannelAvailability: {
      findMany: vi.fn().mockResolvedValue(over.stored ?? []),
      // recordAvailability reads the current row to decide whether a stored competitive verdict
      // still describes the same ASIN. Null here: these cases are all first checks.
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation((args: any) => { upserts.push(args); return Promise.resolve({}); }),
    },
    channelListing: { findMany: vi.fn().mockResolvedValue(over.listings ?? []) },
    company: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma, upserts };
}

const amazonReturning = (candidates: any[], message?: string) => ({
  findCandidates: vi.fn().mockResolvedValue({ candidates, message }),
}) as any;

describe('deciding whether to run', () => {
  beforeEach(() => vi.useRealTimers());

  it('does nothing while it is switched off', async () => {
    const { prisma } = makePrisma({ settings: { availabilitySweepEnabled: false } });
    const svc = new AvailabilitySweepService(prisma, amazonReturning([]));
    const r = await svc.runDueBatch();
    expect(r.ran).toBe(false);
    expect(prisma.productChannelAvailability.upsert).not.toHaveBeenCalled();
  });

  it('runs when forced even though it is switched off', async () => {
    // The reason to press "run now" is to find out whether it works before leaving it on.
    const { prisma } = makePrisma({ settings: { availabilitySweepEnabled: false } });
    const svc = new AvailabilitySweepService(prisma, amazonReturning([{ asin: 'B1', restricted: false }]));
    expect((await svc.runDueBatch(true)).ran).toBe(true);
  });

  it('waits out the interval', async () => {
    const { prisma } = makePrisma({ settings: { availabilitySweepLastRunAt: new Date(Date.now() - 60 * 60_000) } });
    const svc = new AvailabilitySweepService(prisma, amazonReturning([]));
    const r = await svc.runDueBatch();
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('Not due yet');
  });

  it('runs once the interval has passed', async () => {
    const { prisma } = makePrisma({ settings: { availabilitySweepLastRunAt: new Date(Date.now() - 3 * 60 * 60_000) } });
    const svc = new AvailabilitySweepService(prisma, amazonReturning([{ asin: 'B1', restricted: false }]));
    expect((await svc.runDueBatch()).ran).toBe(true);
  });

  it('claims the slot before doing the work, not after', async () => {
    // A batch of 60 outlives a 5-minute tick. Claiming afterwards would let the next tick start the
    // same batch again, and both would ask Amazon the same questions.
    const { prisma } = makePrisma();
    const order: string[] = [];
    prisma.platformSettings.update = vi.fn().mockImplementation(() => { order.push('claim'); return Promise.resolve({}); });
    const amazon = {
      findCandidates: vi.fn().mockImplementation(() => { order.push('ask'); return Promise.resolve({ candidates: [] }); }),
    } as any;
    await new AvailabilitySweepService(prisma, amazon).runDueBatch();
    expect(order[0]).toBe('claim');
  });

  it('refuses to start a second batch while one is running', async () => {
    const { prisma } = makePrisma();
    let release: () => void = () => {};
    const amazon = {
      findCandidates: vi.fn().mockImplementation(() => new Promise((res) => { release = () => res({ candidates: [] }); })),
    } as any;
    const svc = new AvailabilitySweepService(prisma, amazon);

    const first = svc.runDueBatch(true);
    await vi.waitFor(() => expect(amazon.findCandidates).toHaveBeenCalled());
    const second = await svc.runDueBatch(true);
    expect(second.ran).toBe(false);
    expect(second.reason).toBe('A batch is already running');

    release();
    await first;
  });
});

describe('what gets written', () => {
  it('records the ASIN and the gating verdict Amazon returned', async () => {
    const { prisma, upserts } = makePrisma();
    const amazon = amazonReturning([
      { asin: 'B00X', productType: 'HEALTH', title: 'A thing', restricted: true, restrictionReasons: [{ message: 'Approval required' }] },
    ]);
    await new AvailabilitySweepService(prisma, amazon).runDueBatch(true);

    expect(upserts).toHaveLength(1);
    expect(upserts[0].create).toMatchObject({
      productId: 'p1', integrationId: 'i1', companyId: 'c1', marketplace: 'ES',
      found: true, asin: 'B00X', restricted: true, restrictionReason: 'Approval required', source: 'scheduled',
    });
  });

  it('records "not in the catalogue" as an answer, not as a gap', async () => {
    // Nothing to attach an offer to is a real finding and the reason a card should stay grey. If it
    // were left unwritten the pair would look unchecked and be re-asked every cycle forever.
    const { prisma, upserts } = makePrisma();
    const amazon = amazonReturning([], 'No catalogue entry for this identifier');
    await new AvailabilitySweepService(prisma, amazon).runDueBatch(true);
    expect(upserts[0].create).toMatchObject({ found: false, asin: null, error: 'No catalogue entry for this identifier' });
  });

  it('writes a row when the marketplace call throws', async () => {
    // A marketplace failing every time must be visible as a column of errors. An absence cannot be
    // told apart from "not reached yet".
    const { prisma, upserts } = makePrisma();
    const amazon = { findCandidates: vi.fn().mockRejectedValue(new Error('403 Forbidden')) } as any;
    const r = await new AvailabilitySweepService(prisma, amazon).runDueBatch(true);
    expect(r.failed).toBe(1);
    expect(upserts[0].create).toMatchObject({ found: false, error: '403 Forbidden' });
  });

  it('keeps going after one pair fails', async () => {
    const { prisma, upserts } = makePrisma({ products: [{ id: 'p1' }, { id: 'p2' }] });
    let call = 0;
    const amazon = {
      findCandidates: vi.fn().mockImplementation(() => {
        call += 1;
        return call === 1 ? Promise.reject(new Error('boom')) : Promise.resolve({ candidates: [{ asin: 'B2', restricted: false }] });
      }),
    } as any;
    const r = await new AvailabilitySweepService(prisma, amazon).runDueBatch(true);
    expect(r).toMatchObject({ checked: 1, failed: 1 });
    expect(upserts).toHaveLength(2);
  });

  it('never asks about a marketplace we already sell on', async () => {
    // The caller's instruction. Checked here as well as on the queue function, because this is the
    // path that actually spends the call.
    const { prisma } = makePrisma({ listings: [{ productId: 'p1', integrationId: 'i1' }] });
    const amazon = amazonReturning([{ asin: 'B1', restricted: false }]);
    await new AvailabilitySweepService(prisma, amazon).runDueBatch(true);
    expect(amazon.findCandidates).not.toHaveBeenCalled();
  });

  it('asks the database for a real identifier, not merely a non-null one', async () => {
    // Prisma's `not: null` lets an empty string through. Against the live catalogue that was 132
    // products, each of which would have had a "not found" stored against every marketplace — a
    // verdict that reads as being about the product when it is really about our own blank field.
    const { prisma } = makePrisma();
    await new AvailabilitySweepService(prisma, amazonReturning([])).runDueBatch(true);
    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { AND: [{ ean: { not: null } }, { ean: { not: '' } }] },
      { AND: [{ upc: { not: null } }, { upc: { not: '' } }] },
    ]);
  });

  it('leaves an unassigned integration alone', async () => {
    // An integration with no company is one nobody has finished setting up. Probing it would reach
    // into an account we cannot say we own.
    const { prisma } = makePrisma({ integrations: [{ id: 'i9', targetCompanyId: null, marketplace: 'DE' }] });
    const amazon = amazonReturning([{ asin: 'B1', restricted: false }]);
    await new AvailabilitySweepService(prisma, amazon).runDueBatch(true);
    expect(amazon.findCandidates).not.toHaveBeenCalled();
  });
});

describe('reporting what the schedule achieves', () => {
  it('counts only the pairs it is responsible for', async () => {
    // Already-listed pairs are somebody else's answer. Counting them would report coverage the
    // sweep neither has nor needs.
    const { prisma } = makePrisma({
      products: [{ id: 'p1' }, { id: 'p2' }],
      integrations: [{ id: 'i1', targetCompanyId: 'c1', marketplace: 'ES' }, { id: 'i2', targetCompanyId: 'c1', marketplace: 'IT' }],
      listings: [{ productId: 'p1', integrationId: 'i1' }],
      stored: [{ productId: 'p2', integrationId: 'i1', checkedAt: new Date('2026-08-01T00:00:00Z') }],
    });
    const s = await new AvailabilitySweepService(prisma, amazonReturning([])).status();
    expect(s.totalPairs).toBe(3);
    expect(s.checkedPairs).toBe(1);
    expect(s.neverChecked).toBe(2);
    expect(s.oldestCheckedAt).toEqual(new Date('2026-08-01T00:00:00Z'));
  });
});
