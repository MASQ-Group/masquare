import { describe, expect, it } from 'vitest';
import { combineFeeBasis, saleLineProfit, type SaleContext, type SaleLine } from './sale-line-profit';

const LINE: SaleLine = {
  quantity: 1,
  netSalesAmount: 30,
  shippingAmount: 0,
  salesChannelSalesFeeAmount: 4.5,
  fbaFulfilmentFeeAmount: 3,
  amazonPointsAmount: null,
  unitCostSnapshotEur: 12,
};
const EUR: SaleContext = { exchangeRate: 1, feeExchangeRate: 1, estimatedFeePct: 0.15 };

describe('saleLineProfit', () => {
  it('earns revenue less the fees the order settled and the cost at the time', () => {
    expect(saleLineProfit(LINE, EUR)).toEqual({
      revenueCents: 3000, feesCents: 750, costCents: 1200, profitCents: 1050, marginPct: 35, feeBasis: 'actual',
    });
  });

  it('counts what the buyer paid for postage as revenue', () => {
    expect(saleLineProfit({ ...LINE, shippingAmount: 3.99 }, EUR).revenueCents).toBe(3399);
  });

  it('costs every unit on the line', () => {
    expect(saleLineProfit({ ...LINE, quantity: 3 }, EUR).costCents).toBe(3600);
  });

  /** Fees settle later than the order; until then the referral percentage is the honest stand-in. */
  it('estimates the fee until the channel settles it, and says so', () => {
    const p = saleLineProfit({ ...LINE, salesChannelSalesFeeAmount: null }, EUR);
    expect(p.feesCents).toBe(750); // 15% of 30.00, plus the FBA fee already on the order
    expect(p.feeBasis).toBe('estimated');
  });

  it('reports no fee basis when nothing settled and no estimate is available', () => {
    const p = saleLineProfit({ ...LINE, salesChannelSalesFeeAmount: null }, { ...EUR, estimatedFeePct: null });
    expect(p.feeBasis).toBe('none');
    expect(p.feesCents).toBe(300); // the FBA fee on the order, and nothing assumed
  });

  /** Five marketplaces cannot be added together in five currencies. */
  it('converts to EUR at the rate stored on the order', () => {
    const p = saleLineProfit(LINE, { exchangeRate: 1.2, feeExchangeRate: 1.2, estimatedFeePct: 0.15 });
    expect(p.revenueCents).toBe(3600);
    expect(p.feesCents).toBe(900);
    expect(p.costCents).toBe(1200); // the cost snapshot is already EUR
  });

  it('uses the fee currency rate when fees were charged in another currency', () => {
    expect(saleLineProfit(LINE, { exchangeRate: 1, feeExchangeRate: 2, estimatedFeePct: null }).feesCents).toBe(1500);
  });

  it('survives a line with nothing on it', () => {
    const p = saleLineProfit({ quantity: 0, netSalesAmount: null, shippingAmount: null, salesChannelSalesFeeAmount: null, fbaFulfilmentFeeAmount: null, amazonPointsAmount: null, unitCostSnapshotEur: null }, EUR);
    expect(p).toMatchObject({ revenueCents: 0, costCents: 0, profitCents: 0, marginPct: null });
  });

  it('shows a loss as a negative profit', () => {
    expect(saleLineProfit({ ...LINE, unitCostSnapshotEur: 25 }, EUR).profitCents).toBeLessThan(0);
  });
});

describe('combineFeeBasis', () => {
  it('says what a day was costed from', () => {
    expect(combineFeeBasis(['actual', 'actual'])).toBe('actual');
    expect(combineFeeBasis(['estimated'])).toBe('estimated');
    expect(combineFeeBasis(['actual', 'estimated'])).toBe('mixed');
    expect(combineFeeBasis(['actual', 'none'])).toBe('mixed');
    expect(combineFeeBasis([])).toBeNull();
  });
});
