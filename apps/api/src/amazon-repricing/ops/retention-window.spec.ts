import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RepricingController } from './repricing.controller';

/**
 * The retention window is the one setting on this page that can quietly degrade pricing rather than
 * break it. The decisions table is read back by the engine — a 30-day median for the fair-pricing
 * ceiling, a 7-day one for the anomaly guard — so a window shorter than that narrows both medians
 * to whatever survived the purge and produces a price weeks later that nobody can account for.
 *
 * These tests pin the boundary, because it is exactly the kind of rule a later refactor would drop
 * without any test going red: every value below still saves, still returns 200, still looks fine.
 */

const stats = { decisions: 0, snapshots: 0, fees: 0, decisionDays: 90, feeDays: 30, decisionsDue: 0, snapshotsDue: 0, feesDue: 0 };

/** Records what reached the database, so an accepted value is proved to be written and not merely tolerated. */
function controller() {
  const writes: any[] = [];
  const prisma = {
    platformSettings: {
      findFirst: async () => ({ id: 'settings-1' }),
      update: async (args: any) => { writes.push(args.data); return args.data; },
      create: async (args: any) => { writes.push(args.data); return args.data; },
    },
  };
  const floors = { retentionStats: async () => stats };
  const c = new RepricingController(
    null as any, floors as any, null as any, null as any,
    prisma as any, null as any, null as any, null as any,
  );
  return { c, writes };
}

describe('retention window', () => {
  it('refuses a decisions window shorter than the 30 days the fair-pricing ceiling reads', async () => {
    const { c, writes } = controller();
    await expect(c.setRetention({ decisionDays: 14 })).rejects.toBeInstanceOf(BadRequestException);
    // The refusal must land before the write, or the value is live regardless of the error.
    expect(writes).toEqual([]);
  });

  it('refuses 30 as well — the median needs a full 30 days behind it, so the floor is 31', async () => {
    const { c } = controller();
    await expect(c.setRetention({ decisionDays: 30 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts 31', async () => {
    const { c, writes } = controller();
    await c.setRetention({ decisionDays: 31 });
    expect(writes).toEqual([{ repricingDecisionRetentionDays: 31 }]);
  });

  it('still allows 0, which means keep forever and purges nothing', async () => {
    const { c, writes } = controller();
    await c.setRetention({ decisionDays: 0 });
    expect(writes).toEqual([{ repricingDecisionRetentionDays: 0 }]);
  });

  it('does not impose the floor on fee estimates, which the engine does not read back by age', async () => {
    const { c, writes } = controller();
    await c.setRetention({ feeDays: 7 });
    expect(writes).toEqual([{ repricingFeeRetentionDays: 7 }]);
  });

  it('rejects a negative window and a fractional one', async () => {
    for (const bad of [-1, 12.5]) {
      const { c } = controller();
      await expect(c.setRetention({ feeDays: bad })).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
