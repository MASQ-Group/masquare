import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { ebayListingApi, type EbayCategorySuggestion, type EbayResolvedAspect } from '../../lib/api';

/**
 * Choosing the eBay category, and answering what it demands.
 *
 * Lives in one file and appears in two places on purpose. The Content tab is where this gets
 * FILLED IN, beside the title and description it belongs with — a category and its item specifics
 * are product copy, not a publishing step. The Channels tab shows the same thing next to the
 * publish button, because that is where somebody discovers it is missing.
 *
 * Two copies of this would drift, and the half that drifted would be the one nobody was looking at.
 *
 * Everything saves to the product's eBay plan, which `publish` already reads — so filling this in
 * on Content is what makes listing later a single button.
 */
export function EbayCategoryPicker({ productId, defaultQuery, compact }: {
  productId: string;
  /** Usually the eBay title being typed on the Content tab; falls back to the product's own. */
  defaultQuery?: string;
  /** Drops the heading, for somewhere that already has one. */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<EbayCategorySuggestion | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  /** What is already saved, so the section opens showing the answer rather than a blank search. */
  const saved = useQuery({
    queryKey: ['ebay', 'saved-plan', productId],
    queryFn: () => ebayListingApi.preview(productId).then((p) => p).catch(() => null),
  });

  const suggest = useMutation({
    mutationFn: () => ebayListingApi.categorySuggestions(productId, query || defaultQuery || undefined),
    onError: () => toast.error('Could not ask eBay for categories'),
  });

  const aspects = useQuery({
    queryKey: ['ebay', 'aspects', productId, chosen?.categoryId],
    queryFn: () => ebayListingApi.categoryAspects(productId, chosen!.categoryId),
    enabled: !!chosen,
  });

  const save = useMutation({
    mutationFn: () => ebayListingApi.savePlan(productId, {
      categoryId: chosen!.categoryId,
      categoryName: chosen!.categoryName,
      /**
       * Only what a person typed. Brand, MPN and Model are re-derived from the product every time
       * rather than frozen here — so correcting a product's brand does not leave its eBay listing
       * quietly carrying the old one.
       */
      aspects: Object.fromEntries(Object.entries(edits).filter(([, v]) => v.trim())),
    }),
    onSuccess: () => {
      toast.success('eBay category saved');
      qc.invalidateQueries({ queryKey: ['ebay'] });
    },
    onError: () => toast.error('Could not save the category'),
  });

  const required = aspects.data?.aspects.filter((a) => a.required) ?? [];

  return (
    <div className="flex flex-col gap-2.5">
      {!compact && (
        <div>
          <label className="label">eBay category</label>
          <p className="-mt-0.5 mb-1.5 text-[12px] text-n-400">
            eBay decides which item specifics are compulsory from the category, so it is chosen here and
            the fields it demands appear below. Nothing is sent to eBay by choosing.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          className="input h-9 flex-1 text-[13px]"
          placeholder={defaultQuery ? `Search eBay — blank searches “${defaultQuery.slice(0, 40)}”` : 'Search eBay categories'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); suggest.mutate(); } }}
        />
        <button type="button" className="hbtn shrink-0" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
          {suggest.isPending ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Suggest
        </button>
      </div>

      {saved.data && !chosen && (
        <div className="text-[12px] text-n-500">
          {saved.data.missing.some((m) => m.key === 'categoryId')
            ? 'No category chosen yet.'
            : 'A category is already saved for this product.'}
        </div>
      )}

      {suggest.data && !suggest.data.ok && <Bad>{suggest.data.message ?? 'eBay returned nothing'}</Bad>}
      {suggest.data?.ok && suggest.data.suggestions.length === 0 && (
        <Bad>eBay had no suggestion for “{suggest.data.searchedFor}”. Try different words.</Bad>
      )}

      {suggest.data?.suggestions.map((s) => (
        <button
          type="button"
          key={s.categoryId}
          onClick={() => { setChosen(s); setEdits({}); }}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-[12.5px] ${
            chosen?.categoryId === s.categoryId ? 'border-teal-300 bg-teal-50' : 'border-n-200 bg-n-0 hover:bg-n-50'}`}
        >
          <span className="mt-[3px] shrink-0">
            {chosen?.categoryId === s.categoryId
              ? <Check size={13} className="text-teal-600" />
              : <span className="block h-3 w-3 rounded-full border border-n-300" />}
          </span>
          <span className="min-w-0">
            <span className="font-medium text-n-800">{s.categoryName}</span>
            <span className="mono ml-2 text-[11px] text-n-400">{s.categoryId}</span>
            <span className="block text-[11.5px] text-n-500">{s.path}</span>
          </span>
        </button>
      ))}

      {chosen && aspects.isLoading && (
        <div className="flex items-center gap-2 text-[12.5px] text-n-500">
          <Loader2 size={13} className="animate-spin" /> Asking eBay what this category needs…
        </div>
      )}

      {aspects.data && (
        <div className="flex flex-col gap-2 rounded-lg border border-n-200 bg-n-25 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">
            {chosen?.categoryName} — {required.length} required item specific{required.length === 1 ? '' : 's'}
            {aspects.data.isSaved && <span className="ml-2 text-teal-700">saved</span>}
          </div>
          {required.length === 0 && (
            <p className="text-[12px] text-n-500">This category demands nothing beyond the listing itself.</p>
          )}
          {required.map((a) => (
            <AspectField
              key={a.name}
              aspect={a}
              value={edits[a.name]}
              onChange={(v) => setEdits({ ...edits, [a.name]: v })}
            />
          ))}
          <button type="button" className="hbtn self-start" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save category
          </button>
          <p className="text-[11.5px] text-n-400">
            Saved against this product. Listing on eBay later uses these without asking again.
          </p>
        </div>
      )}
    </div>
  );
}

function AspectField({ aspect, value, onChange }: {
  aspect: EbayResolvedAspect;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  /**
   * An answer taken from the product is shown as the PLACEHOLDER rather than as content, so the
   * field reads as answered without pretending somebody typed it — and typing still overrides.
   */
  const auto = aspect.source && aspect.source !== 'plan' ? aspect.value : null;
  return (
    <label className="flex items-center gap-2 max-[560px]:flex-col max-[560px]:items-stretch">
      <span className="w-40 shrink-0 text-[12.5px] text-n-700">
        {aspect.name}
        {aspect.rejectedBecause && <span className="ml-1 text-[11px] text-danger">not accepted</span>}
      </span>
      {aspect.mode === 'SELECTION_ONLY' && aspect.values.length ? (
        <select
          className="input h-9 flex-1 text-[13px]"
          value={value ?? aspect.value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— choose —</option>
          {aspect.values.map((v) => <option key={v} value={v}>{v}</option>)}
          {aspect.valueCount > aspect.values.length && (
            <option disabled>…{aspect.valueCount - aspect.values.length} more on eBay</option>
          )}
        </select>
      ) : (
        <input
          className="input h-9 flex-1 text-[13px]"
          placeholder={auto ? `${auto}  (from the product)` : 'required'}
          value={value ?? (aspect.source === 'plan' ? aspect.value ?? '' : '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function Bad({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px] text-danger">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
