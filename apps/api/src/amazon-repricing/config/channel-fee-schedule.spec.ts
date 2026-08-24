import { describe, expect, it } from 'vitest';
import { assertValidSchedule, DEFAULT_REFERRAL_SCHEDULE, scheduleFromChannelFee } from './referral-schedule';
import { netRevenueCents, referralPctAt, type FloorInputs } from '../floor/floor-solver';

/**
 * The floor engine takes its referral fee from the sales channel, as Individual Pricing does.
 *
 * Both were 15% — the engine because it was hard-coded, Individual Pricing because that is what the
 * channel is set to. They agreed by coincidence, and changing a fee in Settings would have made two
 * screens disagree about the same sale without anything looking wrong.
 */
describe('scheduleFromChannelFee', () => {
  it('turns a channel fee into a schedule the solver accepts', () => {
    const s = scheduleFromChannelFee(15);
    expect(() => assertValidSchedule(s)).not.toThrow();
    expect(referralPctAt(1000, s)).toBe(0.15);
  });

  it('follows the channel rather than the old constant', () => {
    expect(referralPctAt(1000, scheduleFromChannelFee(12))).toBe(0.12);
    expect(referralPctAt(1000, scheduleFromChannelFee(8.5))).toBeCloseTo(0.085, 10);
  });

  it('treats a zero fee as a real answer, not a missing one', () => {
    // Some channels genuinely charge nothing. Falling back here would silently reinstate a 15%
    // deduction nobody configured — and a floor 15% too high looks perfectly reasonable on screen.
    const s = scheduleFromChannelFee(0);
    expect(referralPctAt(1000, s)).toBe(0);
    expect(s).not.toBe(DEFAULT_REFERRAL_SCHEDULE);
  });

  it('falls back only when the fee is genuinely absent', () => {
    expect(scheduleFromChannelFee(null)).toBe(DEFAULT_REFERRAL_SCHEDULE);
    expect(scheduleFromChannelFee(undefined)).toBe(DEFAULT_REFERRAL_SCHEDULE);
    expect(scheduleFromChannelFee(Number.NaN)).toBe(DEFAULT_REFERRAL_SCHEDULE);
    // A negative fee is not a rebate, it is bad data.
    expect(scheduleFromChannelFee(-5)).toBe(DEFAULT_REFERRAL_SCHEDULE);
  });

  it('changes the profit a floor is built on, which is the point of wiring it', () => {
    const inputs = (pct: number): FloorInputs => ({
      vatRate: 0,
      referralBrackets: scheduleFromChannelFee(pct),
      cogsLandedCents: 799,
      fixedPerUnitCents: 540,
      fbaFulfillmentFeeCents: 0,
      closingFeeCents: 0,
      refundAdminFeeCents: 0,
      storagePerUnitCents: 0,
      adCostPerUnitCents: 0,
      returnsRate: 0,
    });
    // 3034 at 15% earns 1240; at 12% the three points stay with us.
    expect(netRevenueCents(3034, inputs(15))).toBe(1240);
    expect(netRevenueCents(3034, inputs(12))).toBe(1240 + Math.round(3034 * 0.03));
  });
});
