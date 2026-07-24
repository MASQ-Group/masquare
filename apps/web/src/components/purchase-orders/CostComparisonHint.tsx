import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { costingApi } from '../../lib/api';

interface Props {
  productId: string | null;
  /** The cost currently entered on the line (raw input string). */
  enteredCost: string;
  /** The PO's currency, so we only compare like-for-like. */
  currency: string;
}

const fmt = (v: number, ccy: string) =>
  `${ccy === 'EUR' ? '€' : ccy + ' '}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Under a purchase-order line's cost field: what the product was last purchased at, and
 * whether the cost being entered is up or down against it.
 *
 * Deliberately quiet — it only appears once there's both a picked product and a typed cost,
 * and it renders as a sub-row so the input grid above it stays aligned. When the last PO was
 * in a different currency we still show the figure but drop the up/down verdict, since the
 * two numbers aren't comparable without a rate.
 */
export function CostComparisonHint({ productId, enteredCost, currency }: Props) {
  const { data } = useQuery({
    queryKey: ['last-purchase-cost', productId],
    queryFn: () => costingApi.lastPurchaseCost(productId as string),
    enabled: !!productId,
  });

  if (!productId || !data?.found) return null;

  const last = data.unitCost;
  const sameCcy = data.currency === currency;
  const entered = Number(enteredCost);
  const hasEntered = enteredCost.trim() !== '' && !Number.isNaN(entered);

  const when = data.submittedAt ? new Date(data.submittedAt).toLocaleDateString() : null;
  const base = (
    <>
      Last purchased at <span className="mono font-semibold text-n-700">{fmt(last, data.currency)}</span>
      {' '}on <span className="font-semibold">{data.poNumber}</span>
      {when ? ` · ${when}` : ''}
    </>
  );

  // No verdict yet: nothing typed, or currencies differ so the numbers aren't comparable.
  if (!hasEntered || !sameCcy) {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-n-500">
        {base}
        {!sameCcy && hasEntered && <span className="text-n-400">(different currency — not compared)</span>}
      </div>
    );
  }

  const diff = entered - last;
  const pct = last !== 0 ? (diff / last) * 100 : 0;
  const same = Math.abs(diff) < 0.005;

  // Paying more than last time is the thing to notice (worse), so higher reads as a warning
  // and lower as a saving.
  const tone = same ? 'text-n-500' : diff > 0 ? 'text-danger' : 'text-success';
  const Icon = same ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  const verdict = same
    ? 'same as last'
    : `${diff > 0 ? 'higher' : 'lower'} by ${fmt(Math.abs(diff), currency)} (${Math.abs(pct).toFixed(1)}%)`;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-n-500">
      <span>{base}</span>
      <span className={`inline-flex items-center gap-0.5 font-semibold ${tone}`}>
        <Icon size={12} /> {verdict}
      </span>
    </div>
  );
}
