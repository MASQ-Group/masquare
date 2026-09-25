import type { ReactNode } from 'react';
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
 *
 * It is a report, so it is laid out as one: the answer in a sentence, the evidence in tables with
 * declared column widths, the raw replies folded away. The first version printed the same data into
 * unlabelled columns that squeezed each other until a status read one word per line.
 */

/** A section of the report: a heading, an optional aside, and the evidence under it. */
function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-n-800">{title}</h3>
        {aside ? <span className="text-[11.5px] text-n-500">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

const TH = 'border-b border-n-200 bg-n-25 px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-n-500';
const TD = 'border-b border-n-100 px-3 py-2 align-top text-[12.5px]';

/** A status reads as one thing or not at all, so it never wraps into a column of single words. */
function Verdict({ tone, children }: { tone: 'good' | 'warn' | 'none'; children: ReactNode }) {
  const skin = tone === 'good'
    ? 'border-teal-100 bg-teal-50 text-teal-700'
    : tone === 'warn'
      ? 'border-orange-200 bg-orange-50 text-orange-800'
      : 'border-n-200 bg-n-25 text-n-500';
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] ${skin}`}>{children}</span>;
}

export function JiniusCatalogueProbe({ integrationId, onClose }: { integrationId: string; onClose: () => void }) {
  const probe = useQuery({
    queryKey: ['jinius', 'catalogue-probe', integrationId],
    queryFn: () => jiniusCatalogueApi.probe(integrationId),
    retry: false,
  });
  const d = probe.data;
  const carried = d?.sample.filter((s) => s.found).length ?? 0;
  const disagreeing = d?.ourOffers.filter((o) => o.eanDiffers).length ?? 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-[1060px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="flex items-start gap-3 border-b border-n-200 px-5 py-3.5">
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold text-n-900">What Jinius allows</h2>
            <p className="mt-0.5 text-[12.5px] text-n-500">Read from Jinius. Nothing is sent or changed — here or there.</p>
          </div>
          <button type="button" className="text-n-400 hover:text-n-700" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {probe.isLoading && (
            <div className="flex items-center gap-2 py-6 text-[13px] text-n-500">
              <Loader2 size={15} className="animate-spin" /> Asking Jinius…
            </div>
          )}
          {probe.isError && (
            <p className="rounded-md border border-danger-bd bg-danger-bg px-3 py-2.5 text-[12.5px] text-danger">
              {(probe.error as any)?.response?.data?.message ?? 'Jinius could not be asked.'}
            </p>
          )}

          {d && (
            <>
              {/* The answer first: what this run establishes, before any of the evidence for it. */}
              <p className={`rounded-md border px-3 py-2.5 text-[12.5px] ${
                d.listAnswer && !d.listAnswer.works
                  ? 'border-orange-200 bg-orange-50 text-orange-800'
                  : carried > 0 || d.listAnswer?.works
                    ? 'border-teal-100 bg-teal-50 text-teal-800'
                    : 'border-n-200 bg-n-25 text-n-600'
              }`}>
                {d.listAnswer?.message
                  ?? (carried > 0
                    ? `Jinius carries ${carried} of the ${d.sample.length} products sampled, matched on ${d.matchedWith ?? 'their reference'}.`
                    : 'None of the sampled products could be matched — the tables below say why.')}
              </p>

              <Section title="What this shop may do">
                <div className="flex flex-col gap-1.5">
                  {d.capabilities.map((c) => (
                    <div key={c.name} className="flex items-start gap-2 text-[12.5px]">
                      {c.allowed
                        ? <Check size={14} className="mt-0.5 shrink-0 text-success" />
                        : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />}
                      <span className="w-[210px] shrink-0 text-n-800">{c.name}</span>
                      <span className="min-w-0 text-n-500">{c.detail}</span>
                    </div>
                  ))}
                </div>
              </Section>

              <Section
                title="Our own offers there, and what they are attached to"
                aside={d.offerReferenceTypes.length ? `they carry ${d.offerReferenceTypes.join(', ')}` : 'they carry no barcode at all'}
              >
                {disagreeing > 0 && (
                  <p className="mb-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-[12.5px] text-orange-800">
                    <strong>{disagreeing}</strong> of these {d.ourOffers.length} offers sit on a catalogue product whose barcode is not
                    the one we hold. No barcode lookup can match those, whichever side is wrong.
                  </p>
                )}
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col className="w-[110px]" /><col className="w-[160px]" /><col className="w-[140px]" /><col className="w-[170px]" /><col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={TH}>Our SKU</th>
                      <th className={TH}>Their product code</th>
                      <th className={TH}>Their barcode</th>
                      <th className={TH}>Our barcode</th>
                      <th className={TH}>Their title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ourOffers.map((o) => {
                      const theirEan = o.references.find((r) => r.type === 'EAN')?.value ?? null;
                      const own = o.references.find((r) => !['EAN', 'GTIN', 'UPC'].includes(r.type)) ?? null;
                      return (
                        <tr key={o.shopSku || o.productSku || ''} className="hover:bg-n-25">
                          <td className={`${TD} code whitespace-nowrap text-teal-700`}>{o.shopSku}</td>
                          {/* Their code is a 40-character uuid: a readable head here, the whole of it on hover. */}
                          <td className={`${TD} mono truncate text-[11.5px] text-n-500`} title={own ? `${own.type} ${own.value}` : undefined}>
                            {own ? own.value : <span className="text-n-300">none</span>}
                          </td>
                          <td className={`${TD} mono whitespace-nowrap text-[12px] text-n-600`}>
                            {theirEan ?? <span className="text-n-300">none</span>}
                          </td>
                          <td className={`${TD} mono whitespace-nowrap text-[12px] ${o.eanDiffers ? 'text-orange-700' : 'text-n-500'}`}>
                            {o.ourEan ?? <span className="text-n-300">none</span>}
                            {o.eanDiffers && <span className="ml-1 text-[11px]">differs</span>}
                          </td>
                          <td className={`${TD} truncate text-n-600`} title={o.title ?? undefined}>{o.title ?? ''}</td>
                        </tr>
                      );
                    })}
                    {d.ourOffers.length === 0 && (
                      <tr><td className={`${TD} text-n-500`} colSpan={5}>No offers came back to read.</td></tr>
                    )}
                  </tbody>
                </table>
              </Section>

              <Section title="Our barcodes, looked up in their catalogue" aside={`${carried} of ${d.sample.length} found`}>
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col className="w-[110px]" /><col className="w-[140px]" /><col className="w-[200px]" /><col /><col className="w-[150px]" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={TH}>Our SKU</th>
                      <th className={TH}>Barcode asked</th>
                      <th className={TH}>Result</th>
                      <th className={TH}>Product</th>
                      <th className={TH}>Their category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.sample.map((s) => (
                      <tr key={s.reference} className="hover:bg-n-25">
                        <td className={`${TD} code whitespace-nowrap text-teal-700`}>{s.sku ?? '—'}</td>
                        <td className={`${TD} mono whitespace-nowrap text-[12px] text-n-600`}>{s.reference}</td>
                        <td className={TD}>
                          {s.found
                            ? <Verdict tone="good">in their catalogue</Verdict>
                            /* We sell it there, so they hold it: the lookup missed it, not the catalogue. */
                            : s.weSellThere
                              ? <Verdict tone="warn">we sell it there — not found</Verdict>
                              : <Verdict tone="none">not carried</Verdict>}
                        </td>
                        <td className={`${TD} truncate text-n-600`} title={s.title ?? s.ourTitle ?? undefined}>
                          {s.title ?? s.ourTitle ?? ''}
                        </td>
                        <td className={`${TD} truncate text-n-500`} title={s.categoryLabel ?? undefined}>{s.categoryLabel ?? ''}</td>
                      </tr>
                    ))}
                    {d.sample.length === 0 && (
                      <tr><td className={`${TD} text-n-500`} colSpan={5}>No product here has a barcode to look up.</td></tr>
                    )}
                  </tbody>
                </table>
              </Section>

              {d.lookupAttempts.length > 0 && (
                <Section title="The same lookup, asked several ways">
                  <table className="w-full table-fixed border-collapse">
                    <colgroup><col /><col className="w-[110px]" /><col className="w-[140px]" /></colgroup>
                    <thead>
                      <tr>
                        <th className={TH}>How we asked</th>
                        <th className={TH}>Answered</th>
                        <th className={TH}>Products back</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.lookupAttempts.map((a) => (
                        <tr key={a.how} className="hover:bg-n-25">
                          <td className={`${TD} text-n-700`}>{a.how}</td>
                          <td className={`${TD} mono whitespace-nowrap text-[12px] text-n-500`}>HTTP {a.status}</td>
                          <td className={`${TD} whitespace-nowrap text-[12px] ${(a.products ?? 0) > 0 ? 'text-teal-700' : 'text-n-500'}`}>
                            {a.products == null ? 'no product list' : `${a.products} product${a.products === 1 ? '' : 's'}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* The raw replies are for diagnosing, not for reading: folded away by default. */}
                  <details className="mt-2 text-[12px]">
                    <summary className="cursor-pointer text-n-500 hover:text-n-700">What Jinius actually answered, verbatim</summary>
                    <div className="mt-1.5 flex flex-col gap-1.5">
                      {d.lookupAttempts.map((a) => (
                        <div key={a.how} className="rounded-md border border-n-200 bg-n-25 p-2">
                          <div className="mb-1 text-[11.5px] text-n-600">{a.how}</div>
                          <pre className="mono max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] text-n-500">{a.excerpt}</pre>
                        </div>
                      ))}
                    </div>
                  </details>
                </Section>
              )}

              {d.attributesFor && (
                <Section
                  title="What one of their categories demands"
                  aside={<><span className="mono">{d.attributesFor}</span> · {d.attributeCount} attributes in all</>}
                >
                  {d.requiredAttributes.length === 0
                    ? <p className="text-[12.5px] text-n-500">Nothing is marked required in that category.</p>
                    : (
                      <div className="flex flex-wrap gap-1.5">
                        {d.requiredAttributes.map((a) => (
                          <span
                            key={a.code}
                            className="whitespace-nowrap rounded-full border border-n-200 bg-n-50 px-2 py-0.5 text-[11.5px] text-n-600"
                            title={a.valuesList ? `Answered from their "${a.valuesList}" list` : a.type ?? ''}
                          >
                            {a.label}
                          </span>
                        ))}
                      </div>
                    )}
                </Section>
              )}

              {d.categories.length > 0 && (
                <details className="text-[12px] text-n-600">
                  <summary className="cursor-pointer text-n-500 hover:text-n-700">
                    Their categories ({d.categoryCount ?? d.categories.length}) — first {d.categories.length}
                  </summary>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {d.categories.map((c) => (
                      <span key={c.code} className="whitespace-nowrap rounded-full border border-n-200 bg-n-25 px-2 py-0.5 text-[11.5px] text-n-600">
                        {c.label}
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-n-200 px-5 py-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
