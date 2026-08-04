import { describe, it, expect } from 'vitest';
import { landedTargetAgainst, matrixOffsetPct } from './matrix';

const P = { fbmPremiumPct: 0.03, fbmUndercutPct: 0.05, beatByCents: 2 };

describe('matrixOffsetPct', () => {
  it('positive premium when we out-deliver', () => {
    expect(matrixOffsetPct(2, 1, P)).toBe(0.03);
  });
  it('negative undercut when we under-deliver', () => {
    expect(matrixOffsetPct(0, 2, P)).toBe(-0.05);
  });
  it('zero at equal delivery tier', () => {
    expect(matrixOffsetPct(2, 2, P)).toBe(0);
  });
});

describe('landedTargetAgainst', () => {
  it('matches and shaves beatByCents at equal tier', () => {
    expect(landedTargetAgainst(2000, 2, 2, P)).toBe(1998);
  });
  it('prices above a worse-delivery competitor by the premium', () => {
    expect(landedTargetAgainst(2000, 2, 1, P)).toBe(2060); // +3%
  });
  it('undercuts a better-delivery competitor', () => {
    expect(landedTargetAgainst(2000, 0, 2, P)).toBe(1900); // −5%
  });
  it('never returns a negative price', () => {
    expect(landedTargetAgainst(1, 2, 2, P)).toBe(0);
  });
});
