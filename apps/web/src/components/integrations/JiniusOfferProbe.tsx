import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import { jiniusCatalogueApi } from '../../lib/api';

/**
 * One Jinius offer, exactly as Jinius describes it, beside what we hold for it.
 *
 * Built because their API and their seller portal disagreed: OF21 answered quantity 3 for
 * 65-16567828 while the portal showed 1, minutes after the pull, with nothing ever pushed from here.
 * No summary of ours can settle that — only the field names Jinius actually sends, which is why this
 * shows every one of them rather than the three the platform happens to store.
 *
 * Reads only. Nothing is sent to Jinius but a request for its own offer list.
 */
const TH = 'border-b border-n-200 bg-n-25 px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-n-500';
const TD = 'border-b border-n-100 px-3 py-2 align-top text-[12.5px]';

export function JiniusOfferProbe({ integrationId, onClose }: { integrationId: string; onClose: () => void }) {
  const [sku, setSku] = useState('');
  const probe = useMutation({ mutationFn: (s: string) => jiniusCatalogueApi.offer(s, integrationId) });
  const d = probe.data;

  const ask = (e: FormEvent) => {
    e.preventDefault();
    const s = sku.trim();
    if (s) probe.mutate(s);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-[820px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="flex items-start gap-3 border-b border-n-200 px-5 py-3.5">
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold text-n-900">Check one Jinius offer</h2>
            <p className="mt-0.5 text-[12.5px] text-n-500">
              Every field Jinius sends for one offer, beside what we hold. Read-only.
            </p>
          </div>
          <button type="button" className="text-n-400 hover:text-n-700" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <form className="flex items-center gap-2" onSubmit={ask}>
            <input
              id="jinius-offer-sku"
              className="code h-9 min-w-0 flex-1 rounded-md border border-n-200 px-3 text-[13px] focus:border-teal-400 focus:outline-none"
              placeholder="Our SKU on Jinius, e.g. 65-16567828"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              disabled={!sku.trim() || probe.isPending}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
            >
              {probe.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Look it up
            </button>
          </form>

          {probe.isPending && (
            <p className="text-[12.5px] text-n-500">Reading their offer list — every page, until this SKU turns up.</p>
          )}
          {probe.isError && (
            <p className="rounded-md border border-danger-bd bg-danger-bg px-3 py-2.5 text-[12.5px] text-danger">
              {(probe.error as any)?.response?.data?.message ?? 'Jinius could not be asked.'}
            </p>
          )}

          {d && (
            <>
              {/* The answer first: the comparison, in a sentence, before the field list behind it. */}
              <p className={`rounded-md border px-3 py-2.5 text-[12.5px] ${
                d.found ? 'border-teal-100 bg-teal-50 text-teal-800' : 'border-orange-200 bg-orange-50 text-orange-800'
              }`}>
                {d.verdict}
              </p>

              <p className="text-[11.5px] text-n-500">
                Read {d.scanned} of {d.totalOffers ?? '—'} offers on the shop.
                {d.ours && (
                  <>
                    {' '}Our row: pulled {d.ours.lastPulledAt ? new Date(d.ours.lastPulledAt).toLocaleString() : 'never'},
                    {' '}pushed {d.ours.lastPushedAt ? new Date(d.ours.lastPushedAt).toLocaleString() : 'never'}.
                  </>
                )}
              </p>

              {d.fields.length > 0 && (
                <table className="w-full table-fixed border-collapse">
                  <colgroup><col className="w-[260px]" /><col /></colgroup>
                  <thead>
                    <tr>
                      <th className={TH}>Field Jinius sent</th>
                      <th className={TH}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.fields.map((f) => (
                      <tr key={f.name} className={f.aboutQuantity ? 'bg-teal-50/40' : 'hover:bg-n-25'}>
                        <td className={`${TD} mono truncate text-[12px] ${f.aboutQuantity ? 'font-semibold text-teal-800' : 'text-n-600'}`} title={f.name}>
                          {f.name}
                        </td>
                        <td className={`${TD} mono break-all text-[12px] text-n-700`}>{f.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
