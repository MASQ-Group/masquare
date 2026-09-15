import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { ebayListingApi } from '../../lib/api';

type Row = { label: string; value: string };

/**
 * The store's words in every eBay description: the name in the header and in "Why …", the short
 * condition in the header, the standard Condition card, and the Shipping & returns lines.
 *
 * On the eBay UK channel card because they belong to the seller account, not to a product: two
 * companies selling on eBay each have their own. Saved with its own button — the text is typed,
 * and saving on every keystroke would re-render thousands of descriptions from half a word.
 *
 * The trust points are not here. They are the same on every listing and fixed in the template.
 */
export function EbayDescriptionStoreSection() {
  const qc = useQueryClient();
  const pre = useQuery({ queryKey: ['ebay', 'prerequisites'], queryFn: () => ebayListingApi.prerequisites(), retry: false });

  const [storeName, setStoreName] = useState('');
  const [conditionLabel, setConditionLabel] = useState('');
  const [conditionNote, setConditionNote] = useState('');
  const [shipping, setShipping] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Filled once from the server; after that the fields are the person's until they save.
  useEffect(() => {
    const d = pre.data?.descriptionStore;
    if (!d || loaded) return;
    setStoreName(d.storeName ?? '');
    setConditionLabel(d.conditionLabel ?? '');
    setConditionNote(d.conditionNote ?? '');
    setShipping(d.shipping.length ? d.shipping : []);
    setLoaded(true);
  }, [pre.data, loaded]);

  const save = useMutation({
    mutationFn: () => ebayListingApi.saveDescriptionStore({
      storeName: storeName.trim() || null,
      conditionLabel: conditionLabel.trim() || null,
      conditionNote: conditionNote.trim() || null,
      shipping: shipping.map((r) => ({ label: r.label.trim(), value: r.value.trim() })).filter((r) => r.label && r.value),
    }),
    onSuccess: () => {
      toast.success('Saved — every eBay description now uses this');
      qc.invalidateQueries({ queryKey: ['ebay'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  if (pre.isError || !pre.data) return null;

  const setRow = (i: number, patch: Partial<Row>) => setShipping((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="col-span-2 flex flex-col gap-3 rounded-md border border-n-200 bg-n-25 p-3 max-[560px]:col-span-1">
      <div>
        <span className="text-[13.5px] font-semibold text-n-800">Description content</span>
        <p className="text-[11.5px] text-n-500">
          The store&apos;s own words in every eBay description. The trust points (&ldquo;100% genuine…&rdquo;) are the
          same on every listing and not edited here.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="ebay-store-name">Store name</label>
          <input id="ebay-store-name" className="input" value={storeName} maxLength={60} onChange={(e) => setStoreName(e.target.value)} placeholder="TogaluUK" />
          <p className="mt-1 text-[11.5px] text-n-500">In the header and in &ldquo;Why {storeName.trim() || '…'}&rdquo;.</p>
        </div>
        <div>
          <label className="label" htmlFor="ebay-condition-label">Condition in the header</label>
          <input id="ebay-condition-label" className="input" value={conditionLabel} maxLength={60} onChange={(e) => setConditionLabel(e.target.value)} placeholder="New · boxed" />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="ebay-condition-note">Condition card</label>
          <textarea id="ebay-condition-note" className="input min-h-[60px] py-2" value={conditionNote} maxLength={400} onChange={(e) => setConditionNote(e.target.value)} placeholder="Brand new and unused, in the original packaging." />
        </div>
      </div>

      <div>
        <span className="label">Shipping &amp; returns</span>
        <div className="flex flex-col gap-1.5">
          {shipping.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={`Shipping line ${i + 1} label`} className="input w-[38%]" value={r.label} maxLength={40} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="Dispatch" />
              <input aria-label={`Shipping line ${i + 1} value`} className="input flex-1" value={r.value} maxLength={120} onChange={(e) => setRow(i, { value: e.target.value })} placeholder="Same day before 2 pm" />
              <button type="button" className="hbtn !px-2" aria-label="Remove line" onClick={() => setShipping((rows) => rows.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {shipping.length < 6 && (
            <button type="button" className="hbtn self-start" onClick={() => setShipping((rows) => [...rows, { label: '', value: '' }])}>
              <Plus size={14} /> Add line
            </button>
          )}
        </div>
        <p className="mt-1 text-[11.5px] text-n-500">
          Dispatch, delivery, returns, ships from. Left empty, the Shipping &amp; returns card is not shown.
        </p>
      </div>

      <button type="button" className="btn btn-primary self-start !h-8 !text-[12.5px]" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending && <Loader2 size={13} className="animate-spin" />} Save description content
      </button>
    </div>
  );
}
