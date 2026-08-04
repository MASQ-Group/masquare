import { describe, it, expect } from 'vitest';
import { parseFeesEstimate } from './fees-parse';

// A representative FeesEstimateResult.FeesEstimate payload (Product Fees API, §4.3).
function result() {
  return {
    FeesEstimate: {
      TimeOfFeesEstimation: '2026-08-01T00:00:00Z',
      TotalFeesEstimate: { CurrencyCode: 'EUR', Amount: 5.55 },
      FeeDetailList: [
        { FeeType: 'ReferralFee', FeeAmount: { CurrencyCode: 'EUR', Amount: 3.15 }, FinalFee: { CurrencyCode: 'EUR', Amount: 3.15 } },
        { FeeType: 'FBAFees', FeeAmount: { CurrencyCode: 'EUR', Amount: 2.4 }, FinalFee: { CurrencyCode: 'EUR', Amount: 2.4 } },
      ],
    },
  };
}

describe('parseFeesEstimate', () => {
  it('extracts referral, FBA fulfilment and total in cents', () => {
    expect(parseFeesEstimate(result())).toEqual({
      referralFeeCents: 315,
      fbaFulfillmentFeeCents: 240,
      closingFeeCents: null,
      totalFeeCents: 555,
    });
  });

  it('prefers FinalFee (net of promotion) over FeeAmount', () => {
    const r = result();
    r.FeesEstimate.FeeDetailList[0].FinalFee = { CurrencyCode: 'EUR', Amount: 2.5 }; // promo-reduced referral
    expect(parseFeesEstimate(r).referralFeeCents).toBe(250);
  });

  it('sums media closing fees (VariableClosingFee + PerItemFee)', () => {
    const r = result();
    r.FeesEstimate.FeeDetailList.push(
      { FeeType: 'VariableClosingFee', FeeAmount: { Amount: 0.5 }, FinalFee: { Amount: 0.5 } } as never,
      { FeeType: 'PerItemFee', FeeAmount: { Amount: 0.99 }, FinalFee: { Amount: 0.99 } } as never,
    );
    expect(parseFeesEstimate(r).closingFeeCents).toBe(149);
  });

  it('returns nulls for a missing/empty estimate rather than throwing', () => {
    expect(parseFeesEstimate(null)).toEqual({ referralFeeCents: null, fbaFulfillmentFeeCents: null, closingFeeCents: null, totalFeeCents: null });
    expect(parseFeesEstimate({ FeesEstimate: { FeeDetailList: [] } }).fbaFulfillmentFeeCents).toBeNull();
  });

  it('ignores unrelated fee types', () => {
    const r = result();
    r.FeesEstimate.FeeDetailList.push({ FeeType: 'SomeFutureFee', FinalFee: { Amount: 9.99 } } as never);
    expect(parseFeesEstimate(r).totalFeeCents).toBe(555); // unchanged
  });
});
