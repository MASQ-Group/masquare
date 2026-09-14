import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, Loader2, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ebayListingApi, type EbayAspectProvenance, type EbayCategorySuggestion, type EbayResolvedAspect } from '../../lib/api';
import { clearScratch, scratchKey, useScratch } from './ebay-scratch';

/**
 * What this picker has in front of it but has not saved: the search text, the results eBay
 * returned, which one is highlighted, and any item specifics typed underneath.
 *
 * Held in the shared tab scratchpad so switching tabs does not throw the search away. See
 * `ebay-scratch` for why it is a scratchpad rather than state.
 */
type Scratch = {
  query: string;
  suggestions: EbayCategorySuggestion[];
  /** Set when eBay answered usefully — no matches, or a reason — rather than when it errored. */
  searchProblem: string | null;
  chosen: EbayCategorySuggestion | null;
  edits: Record<string, string>;
  /** Optional aspects are collapsed by default: a category can demand four and offer forty. */
  showOptional: boolean;
};
const EMPTY: Scratch = { query: '', suggestions: [], searchProblem: null, chosen: null, edits: {}, showOptional: false };

/**
 * Choosing the eBay category, and answering what it demands.
 *
 * Lives in one file and appears in two places on purpose. The eBay content tab is where this gets
 * FILLED IN, first, before anything else on it — eBay decides which item specifics exist FROM the
 * category, so nothing downstream is even knowable until one is chosen. The Channels tab shows the
 * same picker beside the publish button, because that is where somebody discovers one is missing and
 * should not be sent to another tab to fix it.
 *
 * Two copies of this would drift, and the half that drifted would be the one nobody was looking at.
 *
 * Everything saves to the product's eBay plan, which `publish` already reads — so filling it in
 * beforehand is what makes listing later a single button.
 */
export function EbayCategoryPicker({ productId, defaultQuery, compact }: {
  productId: string;
  /** Usually the eBay title if one exists yet; falls back to the product's own title. */
  defaultQuery?: string;
  /** Drops the heading, for somewhere that already has one. */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const key = scratchKey(productId, 'category');
  const [{ query, suggestions, searchProblem, chosen, edits, showOptional }, patch] = useScratch<Scratch>(key, EMPTY);

  /** What is already saved, so the section opens showing the answer rather than a blank search. */
  const saved = useQuery({
    queryKey: ['ebay', 'saved-plan', productId],
    queryFn: () => ebayListingApi.preview(productId).then((p) => p).catch(() => null),
  });

  const suggest = useMutation({
    mutationFn: () => ebayListingApi.categorySuggestions(productId, query || defaultQuery || undefined),
    /** Into the scratchpad rather than left on the mutation, which dies with the component. */
    onSuccess: (res) => {
      if (!res.ok) patch({ suggestions: [], searchProblem: res.message ?? 'eBay returned nothing' });
      else if (res.suggestions.length === 0) {
        patch({ suggestions: [], searchProblem: `eBay had no suggestion for “${res.searchedFor}”. Try different words.` });
      } else patch({ suggestions: res.suggestions, searchProblem: null });
    },
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
       * Only what a person touched. Brand, MPN and Model are re-derived from the product every time
       * rather than frozen here — so correcting a product's brand does not leave its eBay listing
       * quietly carrying the old one.
       *
       * Emptied fields ARE sent, as empty strings. The server merges rather than replaces now, so
       * an omitted field means "leave it alone" — which would make clearing an answer impossible if
       * blanks were filtered out here. Untouched fields never enter `edits` at all, so this stays a
       * list of decisions rather than a snapshot of the form.
       */
      aspects: edits,
    }),
    onSuccess: () => {
      toast.success('eBay category saved');
      clearScratch(key);
      qc.invalidateQueries({ queryKey: ['ebay'] });
    },
    onError: () => toast.error('Could not save the category'),
  });

  /**
   * Confirming is a write on its own, separate from saving the form. A person who has just checked
   * a datasheet should not have to save unrelated edits to record that they did.
   */
  const confirm = useMutation({
    mutationFn: (name: string) => ebayListingApi.confirmAspect(productId, name),
    onSuccess: (r) => {
      toast.success(`${r.name} confirmed`);
      qc.invalidateQueries({ queryKey: ['ebay'] });
    },
    onError: () => toast.error('Could not record the confirmation'),
  });

  const required = aspects.data?.aspects.filter((a) => a.required) ?? [];
  const optional = aspects.data?.aspects.filter((a) => !a.required) ?? [];

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
          onChange={(e) => patch({ query: e.target.value })}
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

      {searchProblem && <Bad>{searchProblem}</Bad>}

      {suggestions.map((s) => (
        <button
          type="button"
          key={s.categoryId}
          onClick={() => patch({ chosen: s, edits: {} })}
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
            {chosen?.categoryName} — {required.length} required, {optional.length} optional
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
              onChange={(v) => patch({ edits: { ...edits, [a.name]: v } })}
              onConfirm={() => confirm.mutate(a.name)}
              confirming={confirm.isPending && confirm.variables === a.name}
            />
          ))}

          {/*
            * Optional aspects, behind a toggle. eBay marks a handful compulsory and offers dozens
            * more; showing all of them open would bury the four that actually block a publish. They
            * are worth having — an unanswered optional aspect is a filter the listing drops out of —
            * but they are never the reason somebody cannot list.
            */}
          {optional.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => patch({ showOptional: !showOptional })}
                className="mt-1 flex items-center gap-1.5 self-start text-[12px] font-semibold text-n-600 hover:text-n-800"
              >
                {showOptional ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {optional.length} optional {optional.length === 1 ? 'specific' : 'specifics'}
                <span className="font-normal text-n-400">— not required to list, but they are search filters</span>
              </button>
              {showOptional && optional.map((a) => (
                <AspectField
                  key={a.name}
                  aspect={a}
                  value={edits[a.name]}
                  onChange={(v) => patch({ edits: { ...edits, [a.name]: v } })}
                  onConfirm={() => confirm.mutate(a.name)}
                  confirming={confirm.isPending && confirm.variables === a.name}
                />
              ))}
            </>
          )}
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

function AspectField({ aspect, value, onChange, onConfirm, confirming }: {
  aspect: EbayResolvedAspect;
  value: string | undefined;
  onChange: (v: string) => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  /**
   * An answer taken from the product is shown as the PLACEHOLDER rather than as content, so the
   * field reads as answered without pretending somebody typed it — and typing still overrides.
   */
  const auto = aspect.source && aspect.source !== 'plan' ? aspect.value : null;
  const prov = aspect.provenance ?? null;
  return (
    <div className="flex flex-col gap-1">
    <label className="flex items-center gap-2 max-[560px]:flex-col max-[560px]:items-stretch">
      <span className="w-40 shrink-0 text-[12.5px] text-n-700">
        {aspect.name}
        {aspect.required && <span className="ml-1 text-danger" title="Required by eBay">*</span>}
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
          /**
           * A held-back suggestion shows as a placeholder, never as content. As content it would
           * look answered and get saved by somebody tabbing past it; as a placeholder it is visible,
           * accepted by typing it, and otherwise left alone.
           */
          placeholder={
            auto ? `${auto}  (from the product)`
              : prov?.heldBack ? `${prov.value}  (suggested — not in use)`
                : aspect.required ? 'required' : 'optional'
          }
          value={value ?? (aspect.source === 'plan' ? aspect.value ?? '' : '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
    {prov && <Provenance prov={prov} onConfirm={onConfirm} confirming={confirming} />}
    </div>
  );
}

/**
 * Where this answer came from, under the field it belongs to.
 *
 * Shown for every stored answer rather than only the doubtful ones. A form where provenance appears
 * only when something is wrong teaches people that no badge means "fine", which is exactly the
 * assumption that lets a wrong value sit unchallenged for a year.
 */
function Provenance({ prov, onConfirm, confirming }: {
  prov: EbayAspectProvenance;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const tone = prov.heldBack
    ? (prov.basis === 'conflict' ? 'border-danger-bd bg-danger-bg text-danger' : 'border-warning-bd bg-warning-bg text-warning')
    : 'border-success-bd bg-success-bg text-success';

  return (
    <div className="ml-[168px] flex flex-wrap items-center gap-x-2 gap-y-1 max-[560px]:ml-0">
      <span className={`tag whitespace-nowrap border ${tone}`}>{LABEL[prov.basis]}</span>

      {/*
        * What each source actually said, not just that it was consulted. When two disagree, the
        * disagreement IS the information — collapsing it to "conflict" would hide which value came
        * from where and leave nothing to decide between.
        */}
      {prov.origins.map((o, i) => (
        <span key={`${o.kind}-${i}`} className="inline-flex items-center gap-1 text-[11.5px] text-n-500">
          <span className="text-n-400">{SOURCE[o.kind]}:</span>
          <span className="mono">{o.value}</span>
          {o.url && (
            <a href={o.url} target="_blank" rel="noreferrer" className="text-n-400 hover:text-teal-600" title={o.label ?? o.url}>
              <ExternalLink size={11} />
            </a>
          )}
        </span>
      ))}

      {prov.verifiedAt && <span className="text-[11.5px] text-n-400">confirmed</span>}

      {/*
        * Only offered where it does something. A value the manufacturer already vouches for gains
        * nothing from a confirmation, and a button that changes nothing gets clicked out of habit
        * until the ones that matter are clicked out of habit too.
        */}
      {prov.heldBack && (
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50"
        >
          {confirming ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
          I checked this
        </button>
      )}
    </div>
  );
}

/** Written as what it means for the listing, not as the internal word for the rule. */
const LABEL: Record<EbayAspectProvenance['basis'], string> = {
  user: 'entered here',
  authoritative: 'manufacturer',
  agreement: 'two sources agree',
  unconfirmed: 'one source — held back',
  conflict: 'sources disagree — held back',
};

const SOURCE: Record<EbayAspectProvenance['origins'][number]['kind'], string> = {
  user: 'typed',
  manufacturer: 'manufacturer',
  amazon: 'Amazon',
  ebay: 'eBay',
};

function Bad({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px] text-danger">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
