import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Select } from '@masquare/ui';
import { ebayListingApi, type EbayCondition, type EbayListingDefaults, type EbayPrerequisites, type EbayPreview } from '../../lib/api';
import { Link } from 'react-router-dom';

/**
 * Where this listing ships from and which policies it carries — answered once for the channel, and
 * shown here so nobody has to trust that it was.
 *
 * Read-only until somebody asks to change it. The answer is the same for nearly every product, and
 * four dropdowns on every product would be four chances to pick the wrong one; but a product that
 * really does differ must not need a developer, so "Change for this product" opens them.
 *
 * The quantity is never a choice here: a listing offers the product's availability, which the
 * quantity push already keeps in step with the channels.
 */
/** The conditions the publish can actually send. Anything else would go to eBay as New. */
const EBAY_CONDITIONS: { value: EbayCondition; label: string }[] = [
  { value: 'NEW', label: 'New' },
  { value: 'USED_EXCELLENT', label: 'Used — excellent' },
  { value: 'USED_GOOD', label: 'Used — good' },
];

export function EbayListingChoices({ productId, preview, pre }: {
  productId: string;
  preview: EbayPreview | undefined;
  pre: EbayPrerequisites | undefined;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: (body: Partial<EbayListingDefaults> & { condition?: EbayCondition }) => ebayListingApi.savePlan(productId, body),
    onSuccess: () => {
      toast.success('Saved for this product');
      qc.invalidateQueries({ queryKey: ['ebay', 'preview', productId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  if (!preview || !pre) return null;

  const nameOf = (key: keyof EbayListingDefaults, id: string | null): string => {
    if (!id) return 'Not chosen';
    if (key === 'merchantLocationKey') {
      const l = pre.locations.find((x) => x.key === id);
      return l ? [l.key, [l.city, l.country].filter(Boolean).join(', ')].filter(Boolean).join(' — ') : id;
    }
    const list = key === 'fulfillmentPolicyId' ? pre.fulfillmentPolicies
      : key === 'paymentPolicyId' ? pre.paymentPolicies
      : pre.returnPolicies;
    return list.find((p) => p.id === id)?.name ?? id;
  };

  const optionsFor = (key: keyof EbayListingDefaults) => {
    const opts = key === 'merchantLocationKey'
      ? pre.locations.map((l) => ({ value: l.key, label: nameOf(key, l.key) }))
      : (key === 'fulfillmentPolicyId' ? pre.fulfillmentPolicies
        : key === 'paymentPolicyId' ? pre.paymentPolicies
        : pre.returnPolicies).map((p) => ({ value: p.id, label: p.name ?? p.id }));
    return [
      { value: '', label: `Channel default — ${nameOf(key, pre.defaults[key])}` },
      ...opts,
    ];
  };

  const rows: { key: keyof EbayListingDefaults; label: string }[] = [
    { key: 'merchantLocationKey', label: 'Ships from' },
    { key: 'fulfillmentPolicyId', label: 'Postage' },
    { key: 'paymentPolicyId', label: 'Payment' },
    { key: 'returnPolicyId', label: 'Returns' },
  ];

  return (
    <div className="flex flex-col gap-2 border-t border-n-200 pt-3">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-semibold text-n-700">Listing details</span>
        {save.isPending && <Loader2 size={12} className="animate-spin text-n-400" />}
        <button
          type="button"
          className="ml-auto text-[11.5px] font-semibold text-teal-700 hover:underline"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Done' : 'Change for this product'}
        </button>
      </div>

      <dl className="grid gap-x-4 gap-y-1.5 text-[12px] md:grid-cols-2">
        {rows.map((r) => {
          const own = preview.overrides[r.key];
          return (
            <div key={r.key} className="flex flex-col gap-0.5">
              <dt className="text-n-500">{r.label}</dt>
              {editing ? (
                <Select
                  dense
                  value={own ?? ''}
                  onChange={(v) => save.mutate({ [r.key]: v || null } as Partial<EbayListingDefaults>)}
                  options={optionsFor(r.key)}
                />
              ) : (
                <dd className="text-n-800">
                  {nameOf(r.key, preview.listing[r.key])}
                  {own && <span className="ml-1.5 text-[11px] text-warning">this product only</span>}
                </dd>
              )}
            </div>
          );
        })}
        {/*
          * The item's condition, per product.
          *
          * It used to be set in the eBay row's drawer further down, which offered New, Open box and
          * Used — and the publish understands none but the three below, so anything else went to eBay
          * as New. Nothing had been listed that way, but it was one click from selling used goods as
          * new. These are exactly the values the publish sends.
          */}
        <div className="flex flex-col gap-0.5">
          <dt className="text-n-500">Condition</dt>
          {editing ? (
            <Select
              dense
              value={preview.listing.condition}
              onChange={(v) => save.mutate({ condition: v as EbayCondition })}
              options={EBAY_CONDITIONS}
            />
          ) : (
            <dd className="text-n-800">
              {EBAY_CONDITIONS.find((c) => c.value === preview.listing.condition)?.label ?? preview.listing.condition}
            </dd>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-n-500">Quantity</dt>
          <dd className="mono text-n-800">
            {preview.listing.quantity ?? 0}
            <span className="ml-1.5 font-sans text-[11px] text-n-500">from availability</span>
          </dd>
        </div>
      </dl>

      <p className="text-[11.5px] text-n-500">
        Set for every listing on the eBay UK channel in{' '}
        <Link className="font-semibold text-teal-700 hover:underline" to="/settings?tab=sales-channels">
          Settings → Sales channels
        </Link>
        . The quantity follows this product's availability.
      </p>
    </div>
  );
}
