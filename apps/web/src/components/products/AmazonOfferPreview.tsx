import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, ClipboardCheck, Lock, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { amazonListingApi, type AmazonOfferPreview as Preview, type AmazonSubmitResult } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';

/**
 * Ask Amazon whether this offer would be accepted, without creating it.
 *
 * The step worth running every time before listing anything. Amazon validates the real payload and
 * answers with the real issues, so a rejection is found here rather than after an offer exists.
 * Creates nothing: it is the same call as a submission with `mode=VALIDATION_PREVIEW`.
 */
export function AmazonOfferPreview({
  productId, integrationId, asin, onListed,
}: {
  productId: string;
  integrationId: string;
  /** Null until a catalogue candidate has been matched; validation has nothing to attach to. */
  asin: string | null;
  onListed?: () => void;
}) {
  const [showPayload, setShowPayload] = useState(false);
  const [submitted, setSubmitted] = useState<AmazonSubmitResult | null>(null);
  const confirm = useConfirm();

  const run = useMutation({
    mutationFn: () => amazonListingApi.preview(productId, integrationId),
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
    mutationFn: () => amazonListingApi.submit(productId, integrationId),
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
          <ClipboardCheck size={13} /> {run.isPending ? 'Asking Amazon…' : p ? 'Validate again' : 'Validate'}
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
