import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { jiniusListingApi } from '../../lib/api';
import { JiniusCreateProduct } from './JiniusCreateProduct';

/**
 * Step 4 for Jinius: check, then create the offer.
 *
 * Jinius matches its catalogue by EAN, so the check is a real question with a real answer — either
 * they carry this product and an offer can be attached to it, or they do not and it needs a product
 * import, which is a different piece of work. The panel says which, rather than offering a button
 * that would fail.
 *
 * Nothing reaches Jinius until the person confirms, and only then if the platform's listing-writes
 * setting is on — the same two yeses as every other channel.
 */
export function JiniusListingPreview({ productId, integrationId, savePlan, onListed }: {
  productId: string;
  integrationId: string;
  /** Saves the form first, so the offer is built from what is on screen. */
  savePlan: () => Promise<unknown>;
  onListed: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const preview = useMutation({
    mutationFn: async () => { await savePlan(); return jiniusListingApi.preview(productId, integrationId); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not check the offer'),
  });
  const create = useMutation({
    mutationFn: () => jiniusListingApi.create(productId, integrationId, true),
    onSuccess: (r) => {
      setConfirming(false);
      if (r.ok) {
        toast.success(r.message, { duration: 12000 });
        onListed();
      } else {
        toast.error(r.message, { duration: 12000 });
      }
    },
    onError: (e: any) => { setConfirming(false); toast.error(e?.response?.data?.message ?? 'Could not create the offer', { duration: 12000 }); },
  });

  const p = preview.data;
  const canList = !!p && p.blockers.length === 0 && p.liveWrites && !create.isPending;
  const blockersToShow = (p?.blockers ?? []).filter((m) => p?.carried || !m.includes('does not carry'));

  return (
    <div className="flex flex-col gap-2 rounded-md border border-n-200 bg-n-0 px-3 py-2.5 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-n-600">
          Asks Jinius whether it carries this product, and shows the offer that would be created. Nothing is sent until you confirm.
        </span>
        <div className="flex-1" />
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
          disabled={preview.isPending}
          onClick={() => { setConfirming(false); preview.mutate(); }}
        >
          {preview.isPending && <Loader2 size={13} className="animate-spin" />}
          {p ? 'Check again' : 'Check'}
        </button>
      </div>

      {p && (
        <>
          {/* The answer first: do they carry it, and what is it. */}
          {p.carried ? (
            <p className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-teal-900">
              <Check size={13} className="mr-1 inline" />
              Jinius carries this product{p.theirProduct?.title ? <> as <span className="font-medium">{p.theirProduct.title}</span></> : null}
              {p.theirProduct?.categoryLabel ? <> in {p.theirProduct.categoryLabel}</> : null}. An offer can be attached to it.
            </p>
          ) : (
            <>
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">
                <AlertTriangle size={13} className="mr-1 inline" />
                {p.lookupProblem ?? `Jinius does not carry ${p.ean ?? 'this product'}.`}
              </p>
              {/*
                * Offered here because this is the moment it means something: they do not have it, so
                * the way to sell it is to give them the product. Also the road when their own entry
                * is wrong - IT49693 sits on a catalogue product whose barcode is not ours.
                */}
              <JiniusCreateProduct productId={productId} integrationId={integrationId} onCreated={() => preview.mutate()} />
            </>
          )}

          {p.existing && (
            <p className="rounded-md border border-info-bd bg-info-bg px-2.5 py-1.5 text-info">
              An offer already exists under {p.sku} — {p.existing.quantity ?? '—'} at €{p.existing.price?.toFixed(2) ?? '—'}. Change it from Edit price and the stock push.
            </p>
          )}

          {/*
            * "They do not carry it" is already the headline above, so it is not repeated here as a
            * blocker. It stays in the list the API returns — that list is what decides whether the
            * button works — but saying the same sentence twice makes a reader look for a second
            * problem that is not there.
            */}
          {blockersToShow.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-danger-bd bg-danger-bg px-2.5 py-1.5 text-danger">
              {blockersToShow.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
          {p.warnings.map((m) => (
            <p key={m} className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">{m}</p>
          ))}

          {/* What would be sent, in Jinius's own terms. */}
          <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-n-500">Shop SKU</dt>
            <dd className="mono text-n-800">{p.offer.shopSku ?? '—'}</dd>
            <dt className="text-n-500">Attached to</dt>
            <dd className="mono text-n-800">
              {p.offer.productId ? `${p.offer.productIdType} ${p.offer.productId}` : <span className="text-n-400">nothing yet</span>}
            </dd>
            <dt className="text-n-500">Price</dt>
            <dd className="mono text-n-800">{p.offer.price != null ? `€${p.offer.price.toFixed(2)}` : '—'}</dd>
            <dt className="text-n-500">Quantity</dt>
            <dd className="mono text-n-800">{p.offer.quantity}</dd>
            <dt className="text-n-500">Condition</dt>
            <dd className="mono text-n-800">New (state {p.offer.stateCode})</dd>
          </dl>

          {!p.liveWrites && (
            <p className="text-[11.5px] text-n-500">
              Listing writes are off in Settings, so this checks and validates but sends nothing.
            </p>
          )}

          <div className="flex items-center gap-2 pt-0.5">
            {confirming ? (
              <>
                <span className="text-n-700">Create this offer on Jinius?</span>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-teal-600 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                  disabled={create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending && <Loader2 size={13} className="animate-spin" />} Yes, create it
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center whitespace-nowrap rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-teal-600 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                disabled={!canList}
                onClick={() => setConfirming(true)}
              >
                Create the offer
              </button>
            )}
            {p.planStatus === 'SUBMITTED' && (
              <span className="text-[11.5px] text-n-500">Submitted — the next listings sync confirms it.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
