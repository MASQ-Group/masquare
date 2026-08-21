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
  /** eBay's own rate, when the Amount carries one. */
  exchangeRate: number | null;
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
    exchangeRate: num(m?.exchangeRate),
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


/**
 * What the Finances API says eBay actually charged and paid for an order.
 *
 * The Fulfillment API reports the fee in the ORDER's currency, so there is no conversion to read
 * and no rate to extract — which is why our own FX rate ends up applied where eBay applied theirs.
 * Finances reports in the seller's PAYOUT currency, making it the only place the EUR figure eBay
 * actually used can be obtained.
 */
export interface EbayFinancesRead {
  ok: boolean;
  message: string | null;
  payoutCurrency: string | null;
  transactions: Array<{
    transactionType: string | null;
    bookingEntry: string | null;
    transactionDate: string | null;
    amount: AmountRead;
    totalFeeAmount: AmountRead | null;
    feeTypes: Array<{ feeType: string | null; amount: AmountRead }>;
  }>;
  /** Total fee in the payout currency, summed across the order's transactions. */
  feeInPayoutCurrency: number | null;
}

export function readFinances(json: any): EbayFinancesRead {
  const rows = (json?.transactions ?? []) as any[];
  const transactions = rows.map((t) => ({
    transactionType: t?.transactionType ?? null,
    bookingEntry: t?.bookingEntry ?? null,
    transactionDate: t?.transactionDate ?? null,
    amount: readAmount(t?.amount),
    totalFeeAmount: t?.totalFeeAmount ? readAmount(t.totalFeeAmount) : null,
    feeTypes: ((t?.orderLineItems ?? []) as any[])
      .flatMap((li) => (li?.marketplaceFees ?? []) as any[])
      .map((f) => ({ feeType: f?.feeType ?? null, amount: readAmount(f?.amount) })),
  }));

  // Fees appear either as a total on the transaction or itemised per line; prefer the total.
  let fee: number | null = null;
  for (const t of transactions) {
    const v = t.totalFeeAmount?.value ?? (t.feeTypes.length ? t.feeTypes.reduce((s, f) => s + (f.amount.value ?? 0), 0) : null);
    if (v != null) fee = Number(((fee ?? 0) + v).toFixed(4));
  }

  const payoutCurrency =
    transactions.find((t) => t.totalFeeAmount?.currency)?.totalFeeAmount?.currency ??
    transactions.find((t) => t.amount.currency)?.amount.currency ??
    null;

  return { ok: true, message: null, payoutCurrency, transactions, feeInPayoutCurrency: fee };
}

/**
 * eBay's own rate for this order: the fee they charged in the payout currency over the same fee
 * in the order's currency. This is the number our FX rate should be replaced by, not adjusted
 * towards — eBay's conversion is what actually reaches the bank.
 */
export function impliedEbayRate(orderCurrencyFee: number | null, payoutCurrencyFee: number | null): number | null {
  if (!orderCurrencyFee || !payoutCurrencyFee) return null;
  return Number((payoutCurrencyFee / orderCurrencyFee).toFixed(6));
}
