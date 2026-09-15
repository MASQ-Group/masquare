import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Select } from '@masquare/ui';
import { ebayListingApi, type EbayListingDefaults } from '../../lib/api';

/**
 * The four answers every eBay listing needs and almost never varies: where goods ship from, and
 * which postage, payment and returns policies apply.
 *
 * Asked once, here, rather than on every product. eBay holds the policies themselves — this only
 * records which of them maSquare uses, so a policy edited at eBay needs no change here, and one
 * deleted there simply stops being offered. A product that genuinely differs can still override any
 * of them on its own Channels tab.
 *
 * Read from eBay live: a saved id that no longer exists would otherwise sit here looking correct
 * until a publish failed.
 *
 * Lives on the eBay UK channel's own card. It was a section under the whole sales-channel table,
 * which put eBay's settings where they looked like everyone's.
 */
export function EbayListingDefaultsSection() {
  const qc = useQueryClient();
  const pre = useQuery({ queryKey: ['ebay', 'prerequisites'], queryFn: () => ebayListingApi.prerequisites() });

  const save = useMutation({
    mutationFn: (body: Partial<EbayListingDefaults>) => ebayListingApi.saveDefaults(body),
    onSuccess: () => {
      toast.success('Saved — new listings will use this');
      // Both the account view here and every product's publish gate read these.
      qc.invalidateQueries({ queryKey: ['ebay'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  // No eBay account on this company: nothing to choose, and an empty form would read as a fault.
  if (pre.isError) return null;

  const d = pre.data?.defaults;
  const locations = pre.data?.locations ?? [];
  const rows: { key: keyof EbayListingDefaults; label: string; hint: string; options: { value: string; label: string }[] }[] = [
    {
      key: 'merchantLocationKey',
      label: 'Merchant location',
      hint: 'Where eBay tells buyers the item ships from.',
      options: locations.map((l) => ({
        value: l.key,
        label: [l.key, [l.city, l.country].filter(Boolean).join(', ')].filter(Boolean).join(' — '),
      })),
    },
    {
      key: 'fulfillmentPolicyId',
      label: 'Postage policy',
      hint: 'The postage services and costs buyers see.',
      options: (pre.data?.fulfillmentPolicies ?? []).map((p) => ({ value: p.id, label: p.name ?? p.id })),
    },
    {
      key: 'paymentPolicyId',
      label: 'Payment policy',
      hint: 'How buyers pay.',
      options: (pre.data?.paymentPolicies ?? []).map((p) => ({ value: p.id, label: p.name ?? p.id })),
    },
    {
      key: 'returnPolicyId',
      label: 'Returns policy',
      hint: 'The returns terms on the listing.',
      options: (pre.data?.returnPolicies ?? []).map((p) => ({ value: p.id, label: p.name ?? p.id })),
    },
  ];

  const unanswered = rows.filter((r) => !d?.[r.key]).map((r) => r.label);

  return (
    <div className="col-span-2 flex flex-col gap-3 rounded-md border border-n-200 bg-n-25 p-3">
      <div>
        <span className="text-[13.5px] font-semibold text-n-800">Listing defaults</span>
        <p className="text-[11.5px] text-n-500">
          What every eBay listing uses unless a product says otherwise. eBay keeps the policies
          themselves; this records which of them we list with.
        </p>
      </div>

      {pre.isLoading && (
        <div className="flex items-center gap-2 text-[12.5px] text-n-500">
          <Loader2 size={13} className="animate-spin" /> Asking eBay for your locations and policies…
        </div>
      )}

      {pre.data && (
        <div className="flex flex-col gap-3">
          {unanswered.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                <b>Not chosen yet:</b> {unanswered.join(', ')}. No product can be published to eBay until each
                one is set.
              </span>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((r) => (
              <label key={r.key} className="flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-n-700">{r.label}</span>
                <Select
                  value={d?.[r.key] ?? ''}
                  disabled={save.isPending}
                  onChange={(v) => save.mutate({ [r.key]: v || null } as Partial<EbayListingDefaults>)}
                  options={[
                    { value: '', label: r.options.length ? 'Not chosen' : 'None on the eBay account' },
                    ...r.options,
                  ]}
                />
                <span className="text-[11.5px] text-n-500">{r.hint}</span>
              </label>
            ))}
          </div>

          <p className="text-[12px] text-n-500">
            A product that has to differ — a bulky item on its own postage policy, say — can override any of
            these on its Channels tab. The quantity is never set here: a listing offers the product's
            availability, and the quantity push keeps it in step.
          </p>
        </div>
      )}
    </div>
  );
}
