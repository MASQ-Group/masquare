import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, PackageX, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Pagination, Select } from '@masquare/ui';
import { availabilityApi, type AvailabilityGapRow } from '../../lib/api';
import { AnchoredPanel } from '../common/AnchoredPanel';
import { CHANNEL_TONE } from '../products/ChannelGroup';

/**
 * SKUs live on a sales channel with no availability row — the onboarding worklist.
 *
 * A listing absent from availability is deliberately ignored by every quantity path: never pushed,
 * never zeroed. That silence is correct but invisible, so a product could sit listed and unmanaged
 * indefinitely with nothing anywhere to say so. This is that gap, named and countable.
 *
 * Rows are grouped by SKU, not by listing: one product on five marketplaces is one job.
 */
export function MissingFromAvailability() {
  const qc = useQueryClient();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [channelType, setChannelType] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const { data, isLoading } = useQuery({
    queryKey: ['availability-missing', { q, channelType, page }],
    queryFn: () => availabilityApi.missing({ q: q || undefined, channelType: channelType || undefined, page, pageSize }),
  });

  const add = useMutation({
    // Zero is the honest opening figure: the product is now tracked, and nobody has counted it yet.
    // It cannot be pushed at zero either — a push would only ever lower a live listing, never raise
    // it, so nothing reaches a marketplace until someone sets a real number.
    mutationFn: (productId: string) => availabilityApi.setQuantity(productId, 0, 'Added from the missing list'),
    onSuccess: () => {
      toast.success('Added to availability — set its quantity next');
      qc.invalidateQueries({ queryKey: ['availability-missing'] });
      qc.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not add it'),
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const th = 'border-b border-n-200 bg-n-25 px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-n-500';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px]';

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex h-8 min-w-[220px] max-w-[300px] flex-1 items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-3">
          <Search size={15} className="text-n-400" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search SKU…" className="flex-1 bg-transparent text-[13px] text-n-900 outline-none placeholder:text-n-400" />
        </div>
        <Select
          dense className="w-44"
          value={channelType}
          onChange={(v) => { setChannelType(v); setPage(1); }}
          options={[{ value: '', label: 'All channels' }, { value: 'amazon', label: 'Amazon' }, { value: 'ebay', label: 'eBay' }, { value: 'onbuy', label: 'OnBuy' }]}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-n-100 px-4 py-2.5 text-[12px] text-n-500">
          <span><strong className="text-n-800">{total}</strong> SKU{total === 1 ? '' : 's'} listed but not in availability</span>
          {!!data?.withProduct && (
            <>
              <span className="text-n-400">·</span>
              <span><strong className="text-n-700">{data.withProduct}</strong> ready to add</span>
            </>
          )}
          {!!data?.withoutProduct && (
            <>
              <span className="text-n-400">·</span>
              <span><strong className="text-n-700">{data.withoutProduct}</strong> need a product first</span>
            </>
          )}
        </div>

        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr>
              <th className={`${th} text-left`}>SKU</th>
              <th className={`${th} text-left`}>Product</th>
              <th className={`${th} text-left`}>Listed on</th>
              <th className={`${th} text-right`}>Live qty</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-[13px] text-n-500">
                Every listed SKU has an availability record.
              </td></tr>
            )}
            {rows.map((r: AvailabilityGapRow) => (
              <tr key={r.channelSku + (r.productId ?? '')} className="hover:bg-teal-50/40">
                <td className={`${td} mono font-medium text-n-800`}>{r.mainSku ?? r.channelSku}</td>
                <td className={td}>
                  {r.productId
                    ? <span className="text-n-700">{r.title ?? '—'}</span>
                    : <span className="inline-flex items-center gap-1.5 text-[12.5px] text-amber-700">
                        <PackageX size={14} /> No product on the platform
                      </span>}
                </td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    {r.channels.map((c) => <PlatformChip key={c.platform} platform={c.platform} markets={c.markets} />)}
                  </div>
                </td>
                <td className={`${td} mono text-right text-n-600`}>{r.listedQuantity || '—'}</td>
                <td className="border-b border-n-100 px-4 py-2.5 text-right">
                  {r.productId ? (
                    <button
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-medium text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
                      disabled={add.isPending}
                      title="Add to availability at zero, then set the real quantity"
                      onClick={() => add.mutate(r.productId as string)}
                    >
                      <PackagePlus size={14} /> Add
                    </button>
                  ) : (
                    <span className="text-[12px] text-n-400">Create the product first</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} pageSize={pageSize} />
    </>
  );
}

const PLATFORM_LABEL: Record<string, string> = { amazon: 'Amazon', ebay: 'eBay', onbuy: 'OnBuy' };
// Channel identity comes from CHANNEL_TONE, the same palette the product card uses, so Amazon is
// amber everywhere rather than amber in one place and something else here. Deliberately clear of
// the semantic colours: a channel chip must never be mistaken for a status.
const UNKNOWN_TONE = 'bg-n-50 text-n-700 border-n-200';

/**
 * One chip per platform, with the individual marketplaces behind it on hover.
 *
 * A SKU can sit on eleven Amazon marketplaces; listing them inline turns a scannable column into a
 * wall of text, and the fact worth seeing at a glance is simply "Amazon". The detail is a hover
 * away, in a portalled panel so it is never clipped by the table's own overflow.
 */
function PlatformChip({ platform, markets }: { platform: string; markets: string[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const label = PLATFORM_LABEL[platform] ?? platform;
  return (
    <>
      <span
        ref={ref}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={`inline-flex cursor-default items-center gap-1 rounded border px-1.5 py-0.5 text-[12px] ${CHANNEL_TONE[platform] ?? UNKNOWN_TONE}`}
      >
        {label}
        <span className="text-[11px] opacity-60">{markets.length}</span>
      </span>
      {open && (
        <AnchoredPanel anchorRef={ref} onClose={() => setOpen(false)} className="w-max max-w-[260px] p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-n-400">Listed on</div>
          <ul className="space-y-0.5">
            {markets.map((m) => <li key={m} className="text-[12.5px] text-n-700">{m}</li>)}
          </ul>
        </AnchoredPanel>
      )}
    </>
  );
}
