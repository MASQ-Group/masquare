import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, ClipboardCheck, Lock, RefreshCw, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { amazonListingApi, type AmazonListingState, type AmazonOfferPreview as Preview, type AmazonSubmitResult } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';

/**
 * Ask Amazon whether this offer would be accepted, without creating it.
 *
 * The step worth running every time before listing anything. Amazon validates the real payload and
 * answers with the real issues, so a rejection is found here rather than after an offer exists.
 * Creates nothing: it is the same call as a submission with `mode=VALIDATION_PREVIEW`.
 */
export function AmazonOfferPreview({
  productId, integrationId, asin, quantity, onListed, savePlan,
}: {
  productId: string;
  integrationId: string;
  /** Units the offer would carry. Zero is valid to Amazon and useless to a buyer. */
  quantity?: number | null;
  /** Null until a catalogue candidate has been matched; validation has nothing to attach to. */
  asin: string | null;
  onListed?: () => void;
  /**
   * Persists the plan as it stands on screen.
   *
   * Validation and submission read the SAVED plan, so without this a price typed but not saved
   * reports as missing — the fields say one thing and the server sees another. Pressing Validate
   * plainly means "validate what I am looking at", so the plan is written first.
   */
  savePlan?: () => Promise<unknown>;
}) {
  const [showPayload, setShowPayload] = useState(false);
  const [submitted, setSubmitted] = useState<AmazonSubmitResult | null>(null);

  /**
   * What Amazon actually thinks of the listing now.
   *
   * The one source of truth after a submission. Amazon accepts synchronously and processes after,
   * so a listing can exist while its price or quantity silently failed to apply — and only Amazon
   * can say why. Read-only.
   */
  const state = useMutation({
    mutationFn: () => amazonListingApi.state(productId, integrationId),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not read the listing from Amazon'),
  });
  const confirm = useConfirm();

  const run = useMutation({
    mutationFn: async () => {
      await savePlan?.();
      return amazonListingApi.preview(productId, integrationId);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not validate with Amazon'),
  });

  const p = run.data;

  /**
   * The one action here a customer can see the result of.
   *
   * Confirmed by name and marketplace rather than a bare "are you sure": the risk is listing the
   * right product in the wrong place, and only the specifics catch that.
   */
  const create = useMutation({
    mutationFn: async () => {
      await savePlan?.();
      return amazonListingApi.submit(productId, integrationId);
    },
    onSuccess: (r) => {
      setSubmitted(r);
      if (r.ok) toast.success(`Offer submitted for ${r.sku}`);
      else toast.error(r.message ?? 'Amazon rejected the submission');
      onListed?.();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not create the listing'),
  });

  const askThenCreate = async () => {
    if (!p || !p.validated) return;
    const ok = await confirm({
      title: 'Create this listing on Amazon?',
      message: (
        <span>
          <b>{p.sku}</b> will be offered on <b>{p.channelName}</b> against ASIN <b>{p.asin}</b>, at the price on this
          plan. It becomes visible to customers. Amazon accepts the submission immediately and processes it after —
          so it may still be rejected once it has been looked at.
        </span>
      ),
      confirmLabel: 'Create the listing',
      tone: 'danger',
    });
    if (ok) create.mutate();
  };

  return (
    <div className="rounded-md border border-n-200 bg-n-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-n-800">Validate with Amazon</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending || !asin}
          title={asin ? undefined : 'Match an Amazon listing above first'}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          <ClipboardCheck size={13} /> {run.isPending ? 'Saving and asking Amazon…' : p ? 'Validate again' : 'Save and validate'}
        </button>
      </div>

      {!asin && (
        <p className="mt-1.5 text-[11.5px] text-n-400">
          Match an Amazon listing above first — validation needs the ASIN the offer would attach to.
        </p>
      )}

      {asin && !p && !run.isPending && (
        <p className="mt-1.5 text-[11.5px] text-n-400">
          Builds the offer from this product and asks Amazon whether it would be accepted. Nothing is created —
          this is the same submission run in validation mode.
        </p>
      )}

      {/* Available whether or not a preview has been run: after a submission this is the question
          worth asking, and it does not depend on anything on screen. */}
      {asin && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-n-100 pt-2">
          <button
            type="button"
            onClick={() => state.mutate()}
            disabled={state.isPending}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
          >
            <RefreshCw size={13} className={state.isPending ? 'animate-spin' : ''} /> Check with Amazon
          </button>
          <span className="text-[11px] text-n-400">Reads the live listing and reports Amazon's own issues.</span>
        </div>
      )}

      {state.data && <ListingState state={state.data} />}

      {p && (
        <div className="mt-2.5 flex flex-col gap-2">
          <Verdict preview={p} />

          {/* Our own gaps come first: Amazon cannot be asked a useful question about an offer that
              is missing its price. */}
          {p.missing.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
              <span>Missing before this can be validated:</span>
              <ul className="ml-4 list-disc">
                {p.missing.map((m) => (
                  <li key={m.key}>
                    <b>{m.label}</b>
                    {m.key === 'price' && ' — set the launch price on this plan, above.'}
                    {m.key === 'quantity' && ' — this product has no sellable quantity recorded. Set it on the Availability page.'}
                    {m.key === 'handlingTime' && ' — set it on this plan, above.'}
                    {m.key === 'asin' && ' — match an Amazon listing above.'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {p.issues.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Amazon's issues</div>
              {p.issues.map((issue, i) => (
                <div
                  key={`${issue.code}-${i}`}
                  className={`rounded-md border px-2.5 py-1.5 text-[12px] ${
                    issue.severity === 'ERROR' ? 'border-danger-bd bg-danger-bg text-danger' : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    {issue.severity === 'ERROR' ? <Ban size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
                    <span className="flex-1">{issue.message}</span>
                  </div>
                  {/* The attribute names are what makes an issue actionable — they say which field. */}
                  {(issue.attributeNames.length > 0 || issue.code) && (
                    <div className="mono mt-0.5 pl-[18px] text-[10.5px] opacity-70">
                      {issue.code}{issue.attributeNames.length > 0 ? ` · ${issue.attributeNames.join(', ')}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Amazon accepts a zero-quantity offer quite happily; it simply cannot be bought. Worth
              saying at the last checkpoint rather than discovering it after nothing sells. */}
          {quantity === 0 && p.validated && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />
              <span>
                This would go live with <b>no stock</b>. Amazon accepts it, but nobody can buy until Availability
                has a quantity — worth setting first unless the listing is deliberately a placeholder.
              </span>
            </div>
          )}

          {submitted ? (
            <div className={`rounded-md border px-2.5 py-2 text-[12px] ${submitted.ok ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-danger-bd bg-danger-bg text-danger'}`}>
              {submitted.ok ? (
                <>
                  <div className="font-semibold">Submitted to Amazon — {submitted.submissionStatus ?? 'accepted'}</div>
                  {/* Accepted is not live. Amazon processes asynchronously and can still reject. */}
                  <div className="mt-0.5 text-[11.5px]">
                    Amazon has taken the submission and will process it. It is not live until Amazon says so — the
                    channel sync will pick the listing up once it is.
                  </div>
                </>
              ) : (
                <div>{submitted.message ?? 'Amazon rejected the submission.'}</div>
              )}
            </div>
          ) : p.validated && p.eligible ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-n-100 pt-2">
              <button
                type="button"
                onClick={askThenCreate}
                disabled={create.isPending || !p.liveWritesEnabled}
                title={p.liveWritesEnabled ? undefined : 'Turn on "Create real marketplace listings" in Settings → General'}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
              >
                <Rocket size={14} /> {create.isPending ? 'Creating…' : 'List on Amazon'}
              </button>
              {!p.liveWritesEnabled && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-n-500">
                  <Lock size={11} /> Creating listings is switched off — Settings &rarr; General
                </span>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-n-500">
            <span>SKU <span className="mono text-n-700">{p.sku}</span></span>
            <span>ASIN <span className="mono text-n-700">{p.asin || '—'}</span></span>
            <span>Type <span className="mono text-n-700">{p.productType}</span></span>
          </div>

          {/* The payload verbatim rather than a summary. On a first run against a new product type
              the exact attribute names are the thing you need to see. */}
          <div>
            <button
              type="button"
              onClick={() => setShowPayload((v) => !v)}
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-n-500 hover:text-n-800"
            >
              {showPayload ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showPayload ? 'Hide' : 'Show'} what would be sent
            </button>
            {showPayload && (
              <pre className="mono mt-1 max-h-[220px] overflow-auto rounded-md border border-n-200 bg-n-25 p-2 text-[10.5px] leading-relaxed text-n-700">
                {JSON.stringify(p.attributes, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Amazon's own view of the listing.
 *
 * Reported verbatim, including when it disagrees with what we submitted: a listing that exists with
 * a price we did not set is the failure mode worth catching, and only this call reveals it.
 */
function ListingState({ state }: { state: AmazonListingState }) {
  if (!state.exists) {
    return (
      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
        Amazon has no listing under this SKU yet. If a submission was just accepted it may still be processing.
      </div>
    );
  }
  const errors = state.issues.filter((i) => i.severity === 'ERROR');
  const warnings = state.issues.filter((i) => i.severity !== 'ERROR');
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-n-200 bg-n-25 px-2.5 py-2 text-[12px]">
        <span className="font-semibold text-n-800">Live on Amazon</span>
        {state.listingStatus && <span className="mono text-n-600">{state.listingStatus}</span>}
        {state.asin && <span className="mono text-n-500">{state.asin}</span>}
        {state.issues.length === 0 && <span className="text-teal-700">no issues reported</span>}
      </div>
      {/* DISCOVERABLE without a purchasable offer is the quiet failure: Amazon took the product
          association and dropped the price and quantity, reporting nothing wrong. */}
      {state.listingStatus === 'DISCOVERABLE' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
          <b>Discoverable, not buyable.</b> Amazon has the product but no valid offer on it — usually the price or
          quantity did not apply. What Amazon actually stored is below.
        </div>
      )}

      {state.attributes && (
        <details className="text-[11.5px] text-n-500">
          <summary className="cursor-pointer hover:text-n-700">What Amazon actually stored</summary>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            <span>purchasable_offer: <b className={state.attributes.purchasable_offer ? 'text-teal-700' : 'text-danger'}>
              {state.attributes.purchasable_offer ? 'present' : 'absent'}</b></span>
            <span>fulfillment_availability: <b className={state.attributes.fulfillment_availability ? 'text-teal-700' : 'text-danger'}>
              {state.attributes.fulfillment_availability ? 'present' : 'absent'}</b></span>
          </div>
          <pre className="mono mt-1 max-h-[240px] overflow-auto rounded-md border border-n-200 bg-n-25 p-2 text-[10.5px] leading-relaxed text-n-700">
            {JSON.stringify({ attributes: state.attributes, offers: state.offers }, null, 2)}
          </pre>
        </details>
      )}

      {[...errors, ...warnings].map((i, n) => (
        <div
          key={`${i.code}-${n}`}
          className={`rounded-md border px-2.5 py-1.5 text-[12px] ${i.severity === 'ERROR' ? 'border-danger-bd bg-danger-bg text-danger' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
        >
          <span>{i.message}</span>
          {i.code && <span className="mono ml-1.5 text-[10.5px] opacity-70">{i.code}</span>}
        </div>
      ))}
    </div>
  );
}

function Verdict({ preview: p }: { preview: Preview }) {
  if (!p.eligible) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-2.5 py-2 text-[12px] text-danger">
        <Ban size={13} className="mt-0.5 shrink-0" />
        <span>This product may not be sold on {p.marketplace}: {p.eligibilityReasons.join('; ')}.</span>
      </div>
    );
  }

  if (p.validated) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-2.5 py-2 text-[12px] text-teal-900">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Check size={13} className="text-teal-600" /> Amazon would accept this offer
        </span>
        {/* Validated is not listed. Saying so here is what stops the green tick being read as done. */}
        {!p.liveWritesEnabled && (
          <span className="inline-flex items-start gap-1.5 text-[11.5px] text-teal-800">
            <Lock size={11} className="mt-0.5 shrink-0" />
            Nothing was created. Live listing writes are switched off on this server.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-2.5 py-2 text-[12px] text-danger">
      <Ban size={13} className="mt-0.5 shrink-0" />
      <span>{p.message ?? 'Amazon would reject this offer.'}</span>
    </div>
  );
}
