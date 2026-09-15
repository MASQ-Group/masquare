import { useEffect, useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react';
import { Select } from '@masquare/ui';
import { ebayListingApi, type EbayDescriptionExtras } from '../../lib/api';

const EMPTY: EbayDescriptionExtras = { series: null, inTheBox: null, care: null, faq: [], glance: [], groups: {} };
const canon = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The eBay description's per-product parts beyond the prose and features: the series line, the
 * at-a-glance figures, In the box, Care, buyer questions, and the heading each item specific sits
 * under in the specification.
 *
 * Claude fills these during research; this is where a person reads and corrects them. They live on
 * the product's eBay plan rather than the product card, so they save with their own button and never
 * travel with a card save.
 *
 * At-a-glance figures are picked FROM verified item specifics and may only shorten one. The same check
 * runs on the server when the description is built, so a figure flagged here is simply left out of
 * the listing rather than published.
 */
export function EbayDescriptionExtrasEditor({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const groupListId = useId();
  const preview = useQuery({
    queryKey: ['ebay', 'preview', productId],
    queryFn: () => ebayListingApi.preview(productId),
  });

  const [x, setX] = useState<EbayDescriptionExtras>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!preview.data || loaded) return;
    setX(preview.data.descriptionExtras ?? EMPTY);
    setLoaded(true);
  }, [preview.data, loaded]);

  const verified = preview.data?.verifiedSpecifics ?? {};
  const verifiedNames = Object.keys(verified);
  const groupNames = useMemo(
    () => [...new Set(['General', ...Object.values(x.groups)].filter(Boolean))],
    [x.groups],
  );

  const save = useMutation({
    mutationFn: () => ebayListingApi.savePlan(productId, { descriptionExtras: x }),
    onSuccess: () => {
      toast.success('Description parts saved');
      qc.invalidateQueries({ queryKey: ['ebay', 'preview', productId] });
      qc.invalidateQueries({ queryKey: ['ebay', 'saved-plan', productId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  if (preview.isLoading) {
    return <p className="flex items-center gap-1.5 text-[12px] text-n-500"><Loader2 size={12} className="animate-spin" /> Loading the description parts…</p>;
  }
  if (!preview.data) return null;
  if (!preview.data.categoryId) {
    return <p className="text-[12px] text-n-500">Choose the eBay category first — these parts are kept with it.</p>;
  }

  const set = (patch: Partial<EbayDescriptionExtras>) => setX((cur) => ({ ...cur, ...patch }));
  const glanceShown = (g: { aspect: string; value: string }) => {
    const v = Object.entries(verified).find(([k]) => canon(k) === canon(g.aspect))?.[1];
    return !!v && !!g.value.trim() && canon(v).includes(canon(g.value));
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-n-200 bg-n-25 p-3">
      <div>
        <span className="text-[12.5px] font-semibold text-n-700">Other description parts</span>
        <p className="text-[11.5px] text-n-500">Written by Claude during research, from the pages. Anything left empty is not shown on the listing.</p>
      </div>

      <div>
        <label className="label" htmlFor={`series-${productId}`}>Series</label>
        <input id={`series-${productId}`} className="input" maxLength={120} value={x.series ?? ''} onChange={(e) => set({ series: e.target.value || null })} placeholder="Casio Vintage series" />
        <p className="mt-1 text-[11.5px] text-n-500">Under the title, before the reference number.</p>
      </div>

      <div>
        <span className="label">At a glance</span>
        <div className="flex flex-col gap-1.5">
          {x.glance.map((g, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[160px] flex-1">
                  <Select
                    dense
                    value={g.aspect}
                    onChange={(v) => set({ glance: x.glance.map((r, j) => (j === i ? { ...r, aspect: v } : r)) })}
                    options={[
                      { value: '', label: 'Item specific…' },
                      ...verifiedNames.map((n) => ({ value: n, label: `${n}: ${verified[n]}` })),
                      ...(g.aspect && !verifiedNames.some((n) => canon(n) === canon(g.aspect)) ? [{ value: g.aspect, label: `${g.aspect} (not verified)` }] : []),
                    ]}
                  />
                </div>
                <input aria-label={`At-a-glance ${i + 1} caption`} className="input w-32" maxLength={40} value={g.label} onChange={(e) => set({ glance: x.glance.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)) })} placeholder="Case width" />
                <input aria-label={`At-a-glance ${i + 1} figure`} className="input mono w-28" maxLength={24} value={g.value} onChange={(e) => set({ glance: x.glance.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)) })} placeholder="33.2 mm" />
                <button type="button" className="hbtn !px-2" aria-label="Remove figure" onClick={() => set({ glance: x.glance.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
              </div>
              {g.aspect && g.value && !glanceShown(g) && (
                <p className="flex items-center gap-1 text-[11.5px] text-warning">
                  <AlertTriangle size={12} /> Not shown: the verified value of &ldquo;{g.aspect}&rdquo; does not contain &ldquo;{g.value}&rdquo;.
                </p>
              )}
            </div>
          ))}
          {x.glance.length < 4 && (
            <button type="button" className="hbtn self-start" disabled={verifiedNames.length === 0} onClick={() => set({ glance: [...x.glance, { aspect: '', label: '', value: '' }] })}>
              <Plus size={14} /> Add figure
            </button>
          )}
        </div>
        <p className="mt-1 text-[11.5px] text-n-500">Three or four figures, each taken from a verified item specific — the figure must be its value or part of it.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label" htmlFor={`box-${productId}`}>In the box</label>
          <textarea id={`box-${productId}`} className="input min-h-[60px] py-2" maxLength={400} value={x.inTheBox ?? ''} onChange={(e) => set({ inTheBox: e.target.value || null })} />
        </div>
        <div>
          <label className="label" htmlFor={`care-${productId}`}>Care</label>
          <textarea id={`care-${productId}`} className="input min-h-[60px] py-2" maxLength={400} value={x.care ?? ''} onChange={(e) => set({ care: e.target.value || null })} />
        </div>
      </div>

      <div>
        <span className="label">Questions</span>
        <div className="flex flex-col gap-1.5">
          {x.faq.map((f, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <input aria-label={`Question ${i + 1}`} className="input min-w-[180px] flex-1" maxLength={200} value={f.q} onChange={(e) => set({ faq: x.faq.map((r, j) => (j === i ? { ...r, q: e.target.value } : r)) })} placeholder="Is the bracelet adjustable?" />
              <input aria-label={`Answer ${i + 1}`} className="input min-w-[220px] flex-[2]" maxLength={600} value={f.a} onChange={(e) => set({ faq: x.faq.map((r, j) => (j === i ? { ...r, a: e.target.value } : r)) })} placeholder="Yes, the clasp slides to fit most wrists." />
              <button type="button" className="hbtn !px-2" aria-label="Remove question" onClick={() => set({ faq: x.faq.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            </div>
          ))}
          {x.faq.length < 6 && (
            <button type="button" className="hbtn self-start" onClick={() => set({ faq: [...x.faq, { q: '', a: '' }] })}><Plus size={14} /> Add question</button>
          )}
        </div>
      </div>

      {verifiedNames.length > 0 && (
        <div>
          <span className="label">Specification groups</span>
          <datalist id={groupListId}>{groupNames.map((g) => <option key={g} value={g} />)}</datalist>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {verifiedNames.map((name) => (
                  <tr key={name} className="border-b border-n-100">
                    <td className="py-1 pr-2 text-n-700">{name}</td>
                    <td className="max-w-[220px] truncate py-1 pr-2 text-n-500" title={verified[name]}>{verified[name]}</td>
                    <td className="py-1">
                      <input
                        aria-label={`Group for ${name}`}
                        className="input !h-7 w-44"
                        list={groupListId}
                        maxLength={40}
                        value={x.groups[name] ?? ''}
                        placeholder="General"
                        onChange={(e) => {
                          const groups = { ...x.groups };
                          if (e.target.value.trim()) groups[name] = e.target.value; else delete groups[name];
                          set({ groups });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11.5px] text-n-500">Brand and MPN always lead General. An item specific with no group goes under General.</p>
        </div>
      )}

      <button type="button" className="btn btn-primary self-start !h-8 !text-[12.5px]" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending && <Loader2 size={13} className="animate-spin" />} Save description parts
      </button>
    </div>
  );
}
