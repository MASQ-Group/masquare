import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Ban, Check, ExternalLink, Search } from 'lucide-react';
import { toast } from 'sonner';
import { amazonListingApi, type AmazonCandidate } from '../../lib/api';

/**
 * Find the Amazon listing this product should attach to.
 *
 * Searched on EAN or UPC and never on the title. A title match is how an offer ends up on a
 * similar-looking product, and the customer then receives the wrong thing at our price — the one
 * mistake in this flow that reaches a buyer.
 *
 * Read-only: it asks Amazon what exists and whether we may offer on it. Nothing is created here.
 */
export function AmazonCandidates({
  productId,
  integrationId,
  selectedAsin,
  onSelect,
}: {
  productId: string;
  integrationId: string;
  selectedAsin: string | null;
  /** Picking a candidate carries its product type too — the offer schema is fetched for it. */
  onSelect: (asin: string, productType: string | null) => void;
}) {
  const [ran, setRan] = useState(false);

  const search = useMutation({
    mutationFn: () => amazonListingApi.candidates(productId, integrationId),
    onSuccess: () => setRan(true),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not search Amazon'),
  });

  const data = search.data;

  return (
    <div className="rounded-md border border-n-200 bg-n-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-n-800">Amazon listing</span>
        {selectedAsin ? (
          <span className="mono inline-flex items-center gap-1.5 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-teal-700">
            <Check size={11} /> {selectedAsin}
          </span>
        ) : (
          <span className="text-[12px] text-n-500">Not matched yet</span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => search.mutate()}
          disabled={search.isPending}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          <Search size={13} /> {search.isPending ? 'Searching Amazon…' : ran ? 'Search again' : 'Find on Amazon'}
        </button>
      </div>

      {/* Said before anyone clicks: this reaches Amazon, unlike everything else on the card. */}
      {!ran && !search.isPending && (
        <p className="mt-1.5 text-[11.5px] text-n-400">
          Searches Amazon's catalogue by this product's EAN or UPC and checks whether we are allowed to offer
          on what it finds. Read-only — nothing is listed.
        </p>
      )}

      {data && (
        <div className="mt-2.5 flex flex-col gap-2">
          {data.searchedBy && (
            <div className="text-[11.5px] text-n-500">
              Searched by <span className="mono">{data.searchedBy.type} {data.searchedBy.value}</span>
            </div>
          )}
          {data.message && <div className="text-[12px] text-amber-700">{data.message}</div>}

          {data.candidates.map((c) => (
            <CandidateRow key={c.asin} candidate={c} selected={c.asin === selectedAsin} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateRow({
  candidate: c, selected, onSelect,
}: {
  candidate: AmazonCandidate;
  selected: boolean;
  onSelect: (asin: string, productType: string | null) => void;
}) {
  // Unknown is not the same as allowed: if the restriction check itself failed, say so and let a
  // human decide rather than presenting it as clear.
  const unknown = c.restricted === null;
  const blocked = c.restricted === true;
  const cleared = c.restricted === false;

  return (
    <div className={`rounded-md border px-2.5 py-2 ${selected ? 'border-teal-300 bg-teal-50' : blocked ? 'border-danger-bd bg-danger-bg' : 'border-n-200 bg-n-0'}`}>
      <div className="flex items-start gap-2.5">
        {c.imageUrl && <img src={c.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded border border-n-200 object-contain" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="mono text-[12px] font-semibold text-n-800">{c.asin}</span>
            {c.brand && <span className="text-[11.5px] text-n-500">{c.brand}</span>}
            {c.productType && <span className="mono rounded bg-n-100 px-1.5 py-px text-[10.5px] text-n-600">{c.productType}</span>}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[12px] text-n-700">{c.title ?? '—'}</div>

          {blocked && (
            <div className="mt-1.5 flex flex-col gap-0.5">
              {c.restrictionReasons.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11.5px] text-danger">
                  <Ban size={11} className="mt-0.5 shrink-0" />
                  <span>{r.message}</span>
                  {r.linkUrl && (
                    <a href={r.linkUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-danger underline">
                      apply <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {unknown && (
            <div className="mt-1.5 text-[11.5px] text-amber-700">
              Could not check whether we may offer on this{c.restrictionError ? ` — ${c.restrictionError}` : ''}.
            </div>
          )}
          {/* Stated, not implied by silence. "Amazon says we may offer" and "we never asked" look
              identical when only the bad cases are drawn, and they are not the same fact. */}
          {cleared && (
            <div className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-teal-700">
              <Check size={11} /> Amazon allows us to offer on this
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onSelect(c.asin, c.productType)}
          disabled={selected}
          // A blocked candidate stays selectable: approval can be applied for, and recording the
          // match now is what makes that worth doing.
          className={`h-7 shrink-0 rounded-md px-2.5 text-[12px] font-semibold ${
            selected
              ? 'bg-teal-500 text-white opacity-70'
              : 'border border-n-200 bg-n-0 text-n-700 hover:border-teal-300 hover:text-teal-700'
          }`}
        >
          {selected ? 'Matched' : 'Use this'}
        </button>
      </div>
    </div>
  );
}
