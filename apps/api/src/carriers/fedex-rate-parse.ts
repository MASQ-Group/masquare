/**
 * Reading a FedEx rate reply.
 *
 * Written against a real Cyprus→GB response rather than a guessed shape — FedEx publishes sample
 * requests but no sample responses, so this waited until one existed. Two things in that reply
 * would not have been guessed correctly:
 *
 *  - The service returned from Cyprus is `FEDEX_INTERNATIONAL_PRIORITY`, not `INTERNATIONAL_PRIORITY`.
 *    Both spellings exist in FedEx's world and only one comes back on this lane.
 *  - Surcharges are `surCharges` at shipment level and `surcharges` at package level. The same list,
 *    two spellings, in one document.
 */

export interface RateSurcharge {
  type: string;
  description: string;
  amount: number;
}

export interface RateOption {
  serviceType: string;
  /** FedEx's own name for the service. Authoritative — better than any table we would keep. */
  serviceName: string;
  /**
   * What WE pay: the negotiated ACCOUNT rate, including fuel and other surcharges.
   *
   * This is the number that belongs in a profit calculation. On the Cyprus→GB quote that produced
   * this parser, International Priority Express came back at €30.65 negotiated against €305.47
   * published — a tenfold difference. Taking the wrong one would not look wrong on a screen.
   */
  netCharge: number;
  currency: string;
  baseCharge: number;
  totalDiscount: number;
  surcharges: RateSurcharge[];
  billingWeightKg: number | null;
  /** The published price, kept so the discount can be shown. Null where FedEx returned none. */
  listCharge: number | null;
  /**
   * True when no negotiated rate came back and `netCharge` is the PUBLISHED price.
   *
   * Never silently substituted: quoting list as though it were ours overstates cost, which is the
   * safer direction for a decision but a lie in a profit figure. The caller is told.
   */
  isListPriceOnly: boolean;
  /** When FedEx commits to deliver. Null where the reply carried no commitment. */
  deliveryAt: string | null;
  deliveryMessage: string | null;
  /** Paperwork FedEx says this shipment needs — commercial invoice, airway bill. */
  requiredDocuments: string[];
  /**
   * Duties and taxes, which are NOT included in `netCharge` unless we are paying them.
   *
   * FedEx says so in its own words on every international quote: "Rate does not include duties &
   * taxes, clearance entry fees or other import fees." Where a marketplace requires us to ship
   * duty-paid, this is the figure that has to reach the profit calculation as well.
   */
  dutiesAndTaxes: number;
}

export interface RateReply {
  options: RateOption[];
  /** FedEx's own notes — postcode corrections and the like. Informational, not failures. */
  alerts: Array<{ code: string; message: string; type: string }>;
  quoteDate: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Surcharges, from whichever spelling this level of the document uses.
 *
 * `surCharges` at shipment level, `surcharges` at package level. Reading only one silently drops
 * the fuel surcharge — 46% of the base charge on the quote this was written against, so a cost
 * understated by a third rather than by a rounding error.
 */
function surchargesOf(detail: any): RateSurcharge[] {
  const list = detail?.surCharges ?? detail?.surcharges ?? [];
  if (!Array.isArray(list)) return [];
  return list.map((s: any) => ({
    type: String(s?.type ?? ''),
    description: String(s?.description ?? ''),
    amount: num(s?.amount),
  }));
}

/** One entry per rate type. ACCOUNT is ours; LIST is the published price. */
const byRateType = (details: any[], type: string) =>
  (Array.isArray(details) ? details : []).find((d) => String(d?.rateType ?? '') === type) ?? null;

export function parseRateReply(body: unknown): RateReply {
  const output = (body as any)?.output ?? {};
  const details = Array.isArray(output.rateReplyDetails) ? output.rateReplyDetails : [];

  const options: RateOption[] = details.map((d: any) => {
    const account = byRateType(d.ratedShipmentDetails, 'ACCOUNT');
    const list = byRateType(d.ratedShipmentDetails, 'LIST');
    // ACCOUNT where it exists. Falling back to LIST is flagged rather than hidden.
    const chosen = account ?? list;
    const rate = chosen?.shipmentRateDetail ?? {};

    return {
      serviceType: String(d.serviceType ?? ''),
      serviceName: String(d.serviceName ?? d.serviceDescription?.description ?? d.serviceType ?? ''),
      netCharge: num(chosen?.totalNetCharge),
      currency: String(chosen?.currency ?? rate?.currency ?? 'EUR'),
      baseCharge: num(chosen?.totalBaseCharge),
      totalDiscount: num(chosen?.totalDiscounts),
      surcharges: surchargesOf(rate),
      billingWeightKg: rate?.totalBillingWeight?.value != null ? num(rate.totalBillingWeight.value) : null,
      listCharge: list ? num(list.totalNetCharge) : null,
      isListPriceOnly: !account && !!list,
      deliveryAt: d.operationalDetail?.deliveryDate ?? d.commit?.dateDetail?.dayFormat ?? null,
      deliveryMessage: Array.isArray(d.commit?.deliveryMessages) ? (d.commit.deliveryMessages[0] ?? null) : null,
      requiredDocuments: Array.isArray(d.commit?.requiredDocuments) ? d.commit.requiredDocuments.map(String) : [],
      dutiesAndTaxes: num(chosen?.totalDutiesAndTaxes),
    };
  });

  return {
    // Cheapest first. Somebody comparing services is nearly always asking what the least costly
    // acceptable option is, and transit time is on every row for when it is not.
    options: options.sort((a, b) => a.netCharge - b.netCharge),
    alerts: (Array.isArray(output.alerts) ? output.alerts : []).map((a: any) => ({
      code: String(a?.code ?? ''),
      message: String(a?.message ?? ''),
      type: String(a?.alertType ?? 'NOTE'),
    })),
    quoteDate: output.quoteDate ?? null,
  };
}
