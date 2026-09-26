import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { jiniusProductApi } from '../../lib/api';

/**
 * Creating the product in Jinius's own catalogue, when attaching to theirs will not do.
 *
 * Offered exactly where the panel has just said Jinius does not carry the product — which is the
 * moment somebody wants it, and the only moment the option means anything. It is also the road for
 * an entry of theirs that is wrong: IT49693 is attached to a catalogue product whose barcode is not
 * ours, and no amount of matching fixes that.
 *
 * Everything is answered from what the platform already holds — the shared facts, the shared words,
 * the images already prepared for OnBuy — so the only thing asked for here is the category, because
 * the category decides which attributes exist.
 */
const TH = 'border-b border-n-200 bg-n-25 px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-n-500';
const TD = 'border-b border-n-100 px-3 py-1.5 align-top text-[12px]';

export function JiniusCreateProduct({ productId, integrationId, onCreated }: {
  productId: string;
  integrationId: string;
  onCreated: () => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<{ code: string; label: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const categories = useQuery({
    queryKey: ['jinius-categories', integrationId, search],
    queryFn: () => jiniusProductApi.categories(search, integrationId),
    enabled: search.trim().length >= 2,
  });

  const preview = useQuery({
    queryKey: ['jinius-create-preview', productId, category?.code],
    queryFn: () => jiniusProductApi.createPreview(productId, category!.code, integrationId),
    enabled: !!category,
  });

  const create = useMutation({
    mutationFn: () => jiniusProductApi.createProduct(productId, category!.code, true, integrationId),
    onSuccess: (r) => {
      setConfirming(false);
      if (r.ok) { toast.success(r.message, { duration: 12000 }); onCreated(); }
      else toast.error(r.message, { duration: 16000 });
    },
    onError: (e: any) => { setConfirming(false); toast.error(e?.response?.data?.message ?? 'Could not create the product', { duration: 16000 }); },
  });

  const p = preview.data;
  const answered = p?.attributes.filter((a) => a.value) ?? [];
  const canCreate = !!p && p.missing.length === 0 && p.liveWrites && !create.isPending;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-n-200 bg-n-0 px-3 py-2.5 text-[12.5px]">
      <div className="text-n-700">
        Create it in their catalogue instead, so the offer carries our own words and images.
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Their category</span>
        <input
          id="jinius-category-search"
          className="input h-8 text-[12.5px]"
          placeholder="Search their 2,469 categories — e.g. espresso"
          value={category ? category.label : search}
          onChange={(e) => { setCategory(null); setSearch(e.target.value); }}
        />
      </label>

      {!category && search.trim().length >= 2 && (
        <div className="max-h-40 overflow-y-auto rounded-md border border-n-200">
          {categories.isLoading && <p className="px-2.5 py-1.5 text-n-500">Asking Jinius…</p>}
          {categories.data?.categories.length === 0 && <p className="px-2.5 py-1.5 text-n-500">Nothing of theirs matches that.</p>}
          {categories.data?.categories.map((c) => (
            <button
              key={c.code}
              type="button"
              className="block w-full px-2.5 py-1.5 text-left hover:bg-n-25"
              onClick={() => { setCategory({ code: c.code, label: c.label }); setSearch(''); }}
            >
              {c.label} <span className="mono text-[11px] text-n-400">{c.code}</span>
            </button>
          ))}
        </div>
      )}

      {preview.isLoading && <p className="flex items-center gap-1.5 text-n-500"><Loader2 size={13} className="animate-spin" /> Asking what that category demands…</p>}
      {preview.isError && <p className="rounded-md border border-danger-bd bg-danger-bg px-2.5 py-1.5 text-danger">{(preview.error as any)?.response?.data?.message ?? 'Jinius could not be asked.'}</p>}

      {p && (
        <>
          {p.missing.length > 0 ? (
            <ul className="flex flex-col gap-0.5 rounded-md border border-danger-bd bg-danger-bg px-2.5 py-1.5 text-danger">
              {p.missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          ) : (
            <p className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-teal-900">
              <Check size={13} className="mr-1 inline" />
              Everything this category demands is answered — {answered.length} of {p.attributes.length} attributes filled from what we already hold.
            </p>
          )}

          {p.imageProblems.map((m) => (
            <p key={m} className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">{m}</p>
          ))}

          <details>
            <summary className="cursor-pointer text-n-500 hover:text-n-700">What would be sent ({answered.length} attributes)</summary>
            <table className="mt-1.5 w-full table-fixed border-collapse">
              <colgroup><col className="w-[200px]" /><col /></colgroup>
              <thead>
                <tr><th className={TH}>Their attribute</th><th className={TH}>Our answer</th></tr>
              </thead>
              <tbody>
                {answered.map((a) => (
                  <tr key={a.code} className="hover:bg-n-25">
                    {/*
                      * The label truncates, the chip does not: truncating the cell clipped "required"
                      * to "require…", which is the one word in the row that has to be readable.
                      */}
                    <td className={`${TD} text-n-600`} title={`${a.label} (${a.code})`}>
                      <span className="flex items-baseline gap-1.5">
                        <span className="min-w-0 truncate">{a.label}</span>
                        {a.required && (
                          <span className="shrink-0 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] text-amber-800">
                            required
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${TD} truncate text-n-800`} title={a.value ?? undefined}>{a.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          {!p.liveWrites && (
            <p className="text-[11.5px] text-n-500">Listing writes are off in Settings, so this checks and validates but sends nothing.</p>
          )}

          <div className="flex items-center gap-2 pt-0.5">
            {confirming ? (
              <>
                <span className="text-n-700">Create this product in Jinius’s catalogue?</span>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-teal-600 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                  disabled={create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending && <Loader2 size={13} className="animate-spin" />} Yes, create it
                </button>
                <button type="button" className="inline-flex h-8 items-center whitespace-nowrap rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300" onClick={() => setConfirming(false)}>Cancel</button>
              </>
            ) : (
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-teal-600 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                disabled={!canCreate}
                onClick={() => setConfirming(true)}
              >
                Create the product
              </button>
            )}
            <span className="text-[11.5px] text-n-400">
              Jinius queues an import, so the result may take a moment to come back.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
