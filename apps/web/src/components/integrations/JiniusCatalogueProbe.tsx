import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { jiniusCatalogueApi } from '../../lib/api';

/**
 * What Jinius allows, asked of Jinius.
 *
 * A Mirakl marketplace decides for itself which product references it matches on, which categories
 * exist, what each demands, and whether a seller may add products to its catalogue at all — and none
 * of that is in Mirakl's documentation, because none of it is the same twice. This asks, before a
 * listing flow is built on assumptions.
 *
 * Reads only: the barcodes are ours already, and asking whether a marketplace carries a product is
 * the question its own search box answers.
 */
export function JiniusCatalogueProbe({ integrationId, onClose }: { integrationId: string; onClose: () => void }) {
  const probe = useQuery({
    queryKey: ['jinius', 'catalogue-probe', integrationId],
    queryFn: () => jiniusCatalogueApi.probe(integrationId),
    retry: false,
  });
  const d = probe.data;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="card flex max-h-[85vh] w-[720px] max-w-full flex-col gap-3 overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h3 className="text-[15px] font-semibold text-n-800">What Jinius allows</h3>
            <p className="text-[12.5px] text-n-500">Read from Jinius. Nothing is sent or changed — here or there.</p>
          </div>
          <button type="button" className="text-n-400 hover:text-n-700" onClick={onClose}><X size={16} /></button>
        </div>

        {probe.isLoading && <p className="flex items-center gap-1.5 text-[13px] text-n-500"><Loader2 size={14} className="animate-spin" /> Asking Jinius…</p>}
        {probe.isError && (
          <p className="rounded-lg border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
            {(probe.error as any)?.response?.data?.message ?? 'Jinius could not be asked.'}
          </p>
        )}

        {d && (
          <>
            <div className="flex flex-col gap-1.5">
              {d.capabilities.map((c) => (
                <div key={c.name} className="flex items-start gap-2 text-[12.5px]">
                  {c.allowed
                    ? <Check size={14} className="mt-0.5 shrink-0 text-success" />
                    : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />}
                  <span className="text-n-800">{c.name}</span>
                  <span className="text-n-500">— {c.detail}</span>
                </div>
              ))}
            </div>

            {d.matchedWith && (
              <p className="text-[12.5px] text-n-600">
                Jinius matches on <span className="mono">{d.matchedWith}</span>
                {d.referenceType && <> and an offer would be created against its <span className="mono">{d.referenceType}</span> reference</>}.
              </p>
            )}

            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-n-500">Our barcodes, looked up in their catalogue</div>
              <table className="w-full text-[12px]">
                <tbody>
                  {d.sample.map((s) => (
                    <tr key={s.reference}>
                      <td className="mono py-1 pr-3 text-teal-700">{s.sku ?? s.reference}</td>
                      <td className="py-1 pr-3 text-n-500">{s.reference}</td>
                      <td className="py-1 pr-3">
                        {s.found
                          ? <span className="text-success">in their catalogue</span>
                          : s.weSellThere
                            /* We sell it there, so they hold it: the lookup missed it, not the catalogue. */
                            ? <span className="text-warning">we sell it there, yet not found</span>
                            : <span className="text-n-400">not carried</span>}
                      </td>
                      <td className="truncate py-1 text-n-600">{s.title ?? s.ourTitle ?? ''}</td>
                      <td className="py-1 text-n-400">{s.categoryLabel ?? ''}</td>
                    </tr>
                  ))}
                  {d.sample.length === 0 && <tr><td className="py-1 text-n-500">No product here has a barcode to look up.</td></tr>}
                </tbody>
              </table>
            </div>

            {d.ourOffers.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-n-500">
                  What our own offers there are attached to
                  <span className="ml-1 font-normal normal-case text-n-400">
                    {d.offerReferenceTypes.length
                      ? `(they carry ${d.offerReferenceTypes.join(', ')})`
                      : '(they carry no barcode at all)'}
                  </span>
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {d.ourOffers.map((o) => (
                      <tr key={o.shopSku || o.productSku || ''}>
                        <td className="mono py-1 pr-3 text-teal-700">{o.shopSku}</td>
                        <td className="mono py-1 pr-3 text-n-500">{o.productSku ?? ''}</td>
                        <td className="py-1 pr-3 text-n-600">
                          {o.references.length
                            ? o.references.map((r) => `${r.type} ${r.value}`).join(', ')
                            : <span className="text-n-400">no reference</span>}
                          {/* Their barcode against ours: where they disagree, no lookup could ever match. */}
                          {o.eanDiffers && (
                            <span className="ml-1 text-warning">— ours is {o.ourEan}</span>
                          )}
                        </td>
                        <td className="truncate py-1 text-n-500">{o.title ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {d.lookupAttempts.length > 0 && (
              <details className="text-[12px]">
                <summary className="cursor-pointer text-n-500 hover:text-n-700">
                  The same lookup, asked {d.lookupAttempts.length} ways — what Jinius actually answered
                </summary>
                <div className="mt-1 flex flex-col gap-1.5">
                  {d.lookupAttempts.map((a) => (
                    <div key={a.how} className="rounded-lg border border-n-200 bg-n-25 p-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-n-700">{a.how}</span>
                        <span className="mono text-[11px] text-n-500">HTTP {a.status}</span>
                        <span className="text-[11px] text-n-500">
                          {a.products == null ? 'no product list in the answer' : `${a.products} product${a.products === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      <pre className="mono mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] text-n-500">{a.excerpt}</pre>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {d.attributesFor && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-n-500">
                  What their category <span className="mono normal-case">{d.attributesFor}</span> demands
                  <span className="ml-1 font-normal normal-case text-n-400">({d.attributeCount} attributes in all)</span>
                </div>
                {d.requiredAttributes.length === 0
                  ? <p className="text-[12.5px] text-n-500">Nothing is marked required in that category.</p>
                  : (
                    <div className="flex flex-wrap gap-1.5">
                      {d.requiredAttributes.map((a) => (
                        <span key={a.code} className="tag border border-n-200 bg-n-50 text-n-600" title={a.valuesList ? `Answered from their "${a.valuesList}" list` : a.type ?? ''}>
                          {a.label}
                        </span>
                      ))}
                    </div>
                  )}
              </div>
            )}

            {d.categories.length > 0 && (
              <details className="text-[12px] text-n-600">
                <summary className="cursor-pointer text-n-500 hover:text-n-700">Their categories ({d.categoryCount ?? d.categories.length}) — first {d.categories.length}</summary>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {d.categories.map((c) => <span key={c.code} className="tag border border-n-200 bg-n-25 text-n-600">{c.label}</span>)}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
