// Read one eBay order's money fields exactly as the API returns them.
//
// eBay converts to the seller's payout currency and reports BOTH figures on its `Amount` type:
// `value`/`currency` is the CONVERTED amount, `convertedFromValue`/`convertedFromCurrency` the
// original. Our mapping reads only `value` and assumes it is in the order's currency, so if eBay
// has already converted a fee to EUR we would convert it a second time — and if it has not, we
// apply our own FX rate where eBay applied theirs.
//
// Which of those is happening cannot be settled from a stored transaction, because by then both
// paths have collapsed into one number. This reports the raw fields so the question is answered
// with data.

export interface AmountRead {
  value: number | null;
  currency: string | null;
  convertedFromValue: number | null;
  convertedFromCurrency: string | null;
  /** True when eBay states it performed a conversion for this amount. */
  converted: boolean;
}

const num = (v: unknown): number | null => {
  const x = Number(String(v ?? '').trim());
  return Number.isFinite(x) && String(v ?? '').trim() !== '' ? x : null;
};

export function readAmount(m: any): AmountRead {
  const value = num(m?.value);
  const currency = m?.currency ?? null;
  const convertedFromValue = num(m?.convertedFromValue);
  const convertedFromCurrency = m?.convertedFromCurrency ?? null;
  return {
    value,
    currency,
    convertedFromValue,
    convertedFromCurrency,
    converted: convertedFromValue != null && !!convertedFromCurrency && convertedFromCurrency !== currency,
  };
}

export interface EbayOrderMoney {
  orderId: string;
  marketplaceId: string | null;
  orderCurrency: string | null;
  amounts: {
    pricingTotal: AmountRead;
    priceSubtotal: AmountRead;
    deliveryCost: AmountRead;
    totalMarketplaceFee: AmountRead;
    lineItemTotals: AmountRead[];
  };
  /** What the platform does with these today, and what it would do if it trusted the currency. */
  interpretation: {
    feeValueWeStore: number | null;
    feeCurrencyEbayStates: string | null;
    feeAlreadyConverted: boolean;
    /**
     * Set when eBay's stated fee currency differs from the order currency. Our mapping treats
     * the fee as being in the order currency, so this is the case where we convert twice.
     */
    mismatch: string | null;
    /** eBay's own rate for this order, when both sides of a conversion are reported. */
    ebayImpliedRate: number | null;
  };
}

/** Summarise one raw eBay order's money fields. Pure — the caller does the fetching. */
export function readOrderMoney(order: any): EbayOrderMoney {
  const orderCurrency =
    order?.pricingSummary?.total?.currency ?? order?.pricingSummary?.priceSubtotal?.currency ?? null;
  const fee = readAmount(order?.totalMarketplaceFee);

  const mismatch =
    fee.currency && orderCurrency && fee.currency !== orderCurrency
      ? `eBay reports the fee in ${fee.currency} but the order is in ${orderCurrency} — the platform treats it as ${orderCurrency} and converts again.`
      : null;

  const ebayImpliedRate =
    fee.converted && fee.value != null && fee.convertedFromValue ? Number((fee.value / fee.convertedFromValue).toFixed(6)) : null;

  return {
    orderId: String(order?.orderId ?? order?.legacyOrderId ?? ''),
    marketplaceId: (order?.lineItems ?? [])[0]?.listingMarketplaceId ?? null,
    orderCurrency,
    amounts: {
      pricingTotal: readAmount(order?.pricingSummary?.total),
      priceSubtotal: readAmount(order?.pricingSummary?.priceSubtotal),
      deliveryCost: readAmount(order?.pricingSummary?.deliveryCost),
      totalMarketplaceFee: fee,
      lineItemTotals: (order?.lineItems ?? []).map((li: any) => readAmount(li?.total)),
    },
    interpretation: {
      feeValueWeStore: fee.value,
      feeCurrencyEbayStates: fee.currency,
      feeAlreadyConverted: fee.converted,
      mismatch,
      ebayImpliedRate,
    },
  };
}
