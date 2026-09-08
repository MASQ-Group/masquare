import { describe, expect, it } from 'vitest';
import { parseRateReply } from './fedex-rate-parse';

/**
 * Parsed against a REAL reply, not an imagined one.
 *
 * The fixture below is trimmed from an actual Cyprus→GB quote on our production account, taken on
 * 8 September 2026. Field names, casing and nesting are exactly as FedEx sent them, because two of
 * the things that matter here would have been got wrong by guessing.
 */

const REAL_REPLY = {
  transactionId: 'd5339688-f908-4498-9b9c-3e9ab1773552',
  output: {
    alerts: [
      { code: 'ORIGIN.STATEORPROVINCECODE.CHANGED', message: 'The origin state/province code has been changed.', alertType: 'NOTE' },
      { code: 'DESTINATION.STATEORPROVINCECODE.CHANGED', message: 'The destination state/province code has been changed.', alertType: 'NOTE' },
    ],
    rateReplyDetails: [
      {
        // No negotiated discount on this service: ACCOUNT and LIST are the same figure.
        serviceType: 'INTERNATIONAL_FIRST',
        serviceName: 'FedEx International First®',
        commit: {
          dateDetail: { dayFormat: '2026-09-09T09:30:00' },
          deliveryMessages: [' 9:30 A.M. IF NO CUSTOMS DELAY'],
          requiredDocuments: ['INTERNATIONAL_AIRWAY_BILL', 'COMMERCIAL_INVOICE'],
        },
        operationalDetail: { deliveryDate: '2026-09-09T09:30:00' },
        ratedShipmentDetails: [
          {
            rateType: 'ACCOUNT', totalDiscounts: 0, totalBaseCharge: 129.67, totalNetCharge: 189.32,
            totalDutiesAndTaxes: 0, currency: 'EUR',
            shipmentRateDetail: {
              totalSurcharges: 59.65,
              // NOTE the capital C. Package level spells the same list `surcharges`.
              surCharges: [{ type: 'FUEL', description: 'Fuel Surcharge', level: 'SHIPMENT', amount: 59.65 }],
              totalBillingWeight: { units: 'KG', value: 2 }, currency: 'EUR',
            },
          },
          {
            rateType: 'LIST', totalDiscounts: 0, totalBaseCharge: 129.67, totalNetCharge: 189.32,
            totalDutiesAndTaxes: 0, currency: 'EUR',
            shipmentRateDetail: { surCharges: [], totalBillingWeight: { units: 'KG', value: 2 }, currency: 'EUR' },
          },
        ],
      },
      {
        // The one that matters: an 81.5% volume discount. Published €305.47, ours €30.65.
        serviceType: 'FEDEX_INTERNATIONAL_PRIORITY_EXPRESS',
        serviceName: 'FedEx International Priority® Express',
        commit: {
          dateDetail: { dayFormat: '2026-09-09T12:00:00' },
          deliveryMessages: ['BY NOON IF NO CUSTOMS DELAY'],
          requiredDocuments: ['INTERNATIONAL_AIRWAY_BILL', 'COMMERCIAL_INVOICE'],
        },
        operationalDetail: { deliveryDate: '2026-09-09T12:00:00' },
        ratedShipmentDetails: [
          {
            rateType: 'ACCOUNT', totalDiscounts: 274.82, totalBaseCharge: 113.45, totalNetCharge: 30.65,
            totalDutiesAndTaxes: 0, currency: 'EUR',
            shipmentRateDetail: {
              surCharges: [{ type: 'FUEL', description: 'Fuel Surcharge', level: 'SHIPMENT', amount: 9.66 }],
              totalBillingWeight: { units: 'KG', value: 2 }, currency: 'EUR',
            },
          },
          {
            rateType: 'LIST', totalDiscounts: 0, totalBaseCharge: 209.23, totalNetCharge: 305.47,
            totalDutiesAndTaxes: 0, currency: 'EUR',
            shipmentRateDetail: { surCharges: [{ type: 'FUEL', description: 'Fuel Surcharge', level: 'SHIPMENT', amount: 96.24 }], currency: 'EUR' },
          },
        ],
      },
    ],
    quoteDate: '2026-09-08',
    encoded: false,
  },
};

describe('the price we take', () => {
  it('takes the negotiated rate, not the published one', () => {
    // €30.65 against €305.47 on the same service. Taking LIST would overstate this shipment
    // tenfold, and nothing on a screen would look wrong — it is just a number.
    const ipe = parseRateReply(REAL_REPLY).options.find((o) => o.serviceType === 'FEDEX_INTERNATIONAL_PRIORITY_EXPRESS')!;
    expect(ipe.netCharge).toBe(30.65);
    expect(ipe.listCharge).toBe(305.47);
    expect(ipe.isListPriceOnly).toBe(false);
  });

  it('keeps the published price so the discount can be shown', () => {
    const ipe = parseRateReply(REAL_REPLY).options.find((o) => o.serviceType === 'FEDEX_INTERNATIONAL_PRIORITY_EXPRESS')!;
    expect(ipe.totalDiscount).toBe(274.82);
  });

  it('flags a fallback to list price rather than passing it off as ours', () => {
    // Quoting list as though it were negotiated overstates cost. Safer as a decision, still a lie
    // in a profit figure — so it is reported, not hidden.
    const listOnly = {
      output: {
        rateReplyDetails: [{
          serviceType: 'X', serviceName: 'X',
          ratedShipmentDetails: [{ rateType: 'LIST', totalNetCharge: 100, currency: 'EUR', shipmentRateDetail: {} }],
        }],
      },
    };
    const o = parseRateReply(listOnly).options[0];
    expect(o.netCharge).toBe(100);
    expect(o.isListPriceOnly).toBe(true);
  });
});

describe('surcharges, and FedEx spelling them two ways', () => {
  it('reads `surCharges` at shipment level', () => {
    // Fuel was 46% of the base charge on this quote. Missing it understates the cost by a third,
    // which is far worse than a rounding error and just as invisible.
    const first = parseRateReply(REAL_REPLY).options.find((o) => o.serviceType === 'INTERNATIONAL_FIRST')!;
    expect(first.surcharges).toEqual([{ type: 'FUEL', description: 'Fuel Surcharge', amount: 59.65 }]);
  });

  it('reads the lower-case `surcharges` spelling too', () => {
    const alt = {
      output: {
        rateReplyDetails: [{
          serviceType: 'X', serviceName: 'X',
          ratedShipmentDetails: [{
            rateType: 'ACCOUNT', totalNetCharge: 10, currency: 'EUR',
            shipmentRateDetail: { surcharges: [{ type: 'FUEL', description: 'Fuel', amount: 3 }] },
          }],
        }],
      },
    };
    expect(parseRateReply(alt).options[0].surcharges[0].amount).toBe(3);
  });

  it('confirms the surcharge is already inside the net charge, not additional to it', () => {
    // 129.67 base + 59.65 fuel = 189.32 net. Adding surcharges on top would double-count them.
    const first = parseRateReply(REAL_REPLY).options.find((o) => o.serviceType === 'INTERNATIONAL_FIRST')!;
    const sum = first.surcharges.reduce((t, s) => t + s.amount, 0);
    expect(Number((first.baseCharge + sum).toFixed(2))).toBe(first.netCharge);
  });
});

describe('duties and taxes', () => {
  it('reports them separately, because they are NOT in the net charge', () => {
    // FedEx says so on every international quote: "Rate does not include duties & taxes, clearance
    // entry fees or other import fees." Where a marketplace obliges us to ship duty-paid, this is a
    // second cost that has to reach the profit calculation.
    for (const o of parseRateReply(REAL_REPLY).options) expect(o.dutiesAndTaxes).toBe(0);
  });
});

describe('what comes back from Cyprus', () => {
  it('uses FedEx\'s own service name rather than a table of ours', () => {
    const first = parseRateReply(REAL_REPLY).options.find((o) => o.serviceType === 'INTERNATIONAL_FIRST')!;
    expect(first.serviceName).toBe('FedEx International First®');
  });

  it('returns FEDEX_INTERNATIONAL_PRIORITY_EXPRESS, the prefixed spelling', () => {
    // Worth pinning. Both prefixed and unprefixed service names exist in FedEx's world, and only
    // what actually comes back on this lane is real. Our hand-written catalogue had one wrong.
    const types = parseRateReply(REAL_REPLY).options.map((o) => o.serviceType);
    expect(types).toContain('FEDEX_INTERNATIONAL_PRIORITY_EXPRESS');
  });

  it('carries the delivery commitment and the paperwork', () => {
    const first = parseRateReply(REAL_REPLY).options.find((o) => o.serviceType === 'INTERNATIONAL_FIRST')!;
    expect(first.deliveryAt).toBe('2026-09-09T09:30:00');
    expect(first.deliveryMessage).toMatch(/9:30 A.M./);
    expect(first.requiredDocuments).toContain('COMMERCIAL_INVOICE');
  });

  it('reports the billing weight FedEx actually rated', () => {
    // Volumetric weight can exceed actual. What FedEx billed on is what a cost should be read from.
    const first = parseRateReply(REAL_REPLY).options.find((o) => o.serviceType === 'INTERNATIONAL_FIRST')!;
    expect(first.billingWeightKg).toBe(2);
  });
});

describe('ordering and alerts', () => {
  it('puts the cheapest first', () => {
    const options = parseRateReply(REAL_REPLY).options;
    expect(options[0].serviceType).toBe('FEDEX_INTERNATIONAL_PRIORITY_EXPRESS');
    expect(options[0].netCharge).toBe(30.65);
  });

  it('keeps FedEx notes as notes, not as failures', () => {
    // "The origin state/province code has been changed" is FedEx tidying our address, not an error.
    // Rendered as a failure it would make every successful quote look broken.
    const { alerts } = parseRateReply(REAL_REPLY);
    expect(alerts).toHaveLength(2);
    expect(alerts[0].type).toBe('NOTE');
  });

  it('survives an empty or unexpected body without throwing', () => {
    expect(parseRateReply({}).options).toEqual([]);
    expect(parseRateReply(null).options).toEqual([]);
    expect(parseRateReply('nonsense').alerts).toEqual([]);
  });
});
