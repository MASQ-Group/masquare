import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { fbaShipmentsApi, type FbaPool, type FbaPoolInput } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';
import { formatDate } from '../../lib/format';

interface Props {
  /** Channels the user may put in a pool — already scoped to the company in view. */
  channels: { id: string; name: string }[];
}

type Draft = {
  id?: string;
  name: string;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string;
  channels: { salesChannelId: string; receives: boolean; sells: boolean }[];
};

const emptyDraft = (): Draft => ({ name: '', active: true, effectiveFrom: '', effectiveTo: '', channels: [] });

const asDateInput = (v: string | null) => (v ? v.slice(0, 10) : '');

/**
 * Which sales channels share one body of inbound stock.
 *
 * Amazon's Pan-European FBA is what this is for: stock is shipped to one marketplace, Amazon
 * redistributes it, and the sale arrives on a marketplace that never received anything. Inbound
 * cost is recorded per channel, so that sale used to find nothing and book no inbound cost at all.
 *
 * It has to be declared here because nothing in the data says so — a shipment to Italy and a sale
 * in Sweden look unrelated, and guessing a connection would be worse than the gap it fills.
 */
export function FulfilmentPools({ channels }: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data: pools = [], isLoading } = useQuery({
    queryKey: ['fba-pools'], queryFn: () => fbaShipmentsApi.listPools(),
  });

  const channelName = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fba-pools'] });
    // The allocated-cost list reads through pools, so it is stale the moment one changes.
    qc.invalidateQueries({ queryKey: ['fba-sku-costs'] });
  };

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body: FbaPoolInput = {
        name: d.name,
        active: d.active,
        effectiveFrom: d.effectiveFrom || null,
        effectiveTo: d.effectiveTo || null,
        channels: d.channels,
      };
      return d.id ? fbaShipmentsApi.updatePool(d.id, body) : fbaShipmentsApi.createPool(body);
    },
    onSuccess: () => { toast.success('Pool saved — FBA costs will use it'); setDraft(null); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the pool'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => fbaShipmentsApi.removePool(id),
    onSuccess: () => { toast.success('Pool removed'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove the pool'),
  });

  const edit = (p: FbaPool) => setDraft({
    id: p.id,
    name: p.name,
    active: p.active,
    effectiveFrom: asDateInput(p.effectiveFrom),
    effectiveTo: asDateInput(p.effectiveTo),
    channels: p.channels.map((c) => ({ salesChannelId: c.salesChannelId, receives: c.receives, sells: c.sells })),
  });

  const askRemove = async (p: FbaPool) => {
    const sells = p.channels.filter((c) => c.sells).length;
    const ok = await confirm({
      title: 'Remove this pool?',
      message: `Orders on ${sells} channel(s) will go back to using only their own inbound shipments, and those with none will show no FBA cost.`,
      confirmLabel: 'Remove pool',
      tone: 'danger',
    });
    if (ok) remove.mutate(p.id);
  };

  return (
    <div className="px-6 py-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="max-w-[760px] text-[13px] leading-relaxed text-n-500">
          Under Pan-European FBA you ship to one marketplace and Amazon fulfils orders from another. A
          pool tells the platform those channels share one body of stock, so a sale on a channel that
          never received a shipment still carries its inbound cost — the average across the pool, since
          once the stock is commingled the unit that sold can no longer be traced to one shipment.
        </p>
        <button className="hbtn-primary shrink-0" onClick={() => setDraft(emptyDraft())}><Plus size={16} /> New pool</button>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-[13px] text-n-400">Loading…</div>
      ) : pools.length === 0 ? (
        <div className="rounded-lg border border-dashed border-n-200 py-12 text-center">
          <Boxes size={22} className="mx-auto mb-2 text-n-300" />
          <div className="text-[13.5px] font-medium text-n-700">No fulfilment pools</div>
          <div className="mt-1 text-[12.5px] text-n-500">Every channel uses only its own inbound shipments.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {pools.map((p) => (
            <div key={p.id} className="rounded-lg border border-n-200 bg-n-0 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-n-900">{p.name}</span>
                    {!p.active && <span className="rounded bg-n-100 px-1.5 py-0.5 text-[11px] font-medium text-n-500">Inactive</span>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-n-500">
                    {p.effectiveFrom || p.effectiveTo
                      ? `${p.effectiveFrom ? formatDate(p.effectiveFrom) : 'Always'} → ${p.effectiveTo ? formatDate(p.effectiveTo) : 'ongoing'}`
                      : 'Applies to every order'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button className="icon-btn" title="Edit pool" onClick={() => edit(p)}><Pencil size={15} /></button>
                  <button className="icon-btn text-danger" title="Remove pool" onClick={() => askRemove(p)}><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.channels.map((c) => (
                  <span key={c.salesChannelId} className="inline-flex items-center gap-1.5 rounded border border-n-200 bg-n-50 px-2 py-1 text-[12px] text-n-700">
                    {c.name ?? channelName.get(c.salesChannelId) ?? 'Unknown channel'}
                    <span className="text-[11px] text-n-400">
                      {c.receives && c.sells ? 'receives + sells' : c.receives ? 'receives' : 'sells'}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <PoolModal
          draft={draft}
          channels={channels}
          busy={save.isPending}
          onChange={setDraft}
          onClose={() => !save.isPending && setDraft(null)}
          onSave={() => save.mutate(draft)}
        />
      )}
    </div>
  );
}

function PoolModal({ draft, channels, busy, onChange, onClose, onSave }: {
  draft: Draft;
  channels: { id: string; name: string }[];
  busy: boolean;
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [adding, setAdding] = useState('');
  const inPool = new Set(draft.channels.map((c) => c.salesChannelId));
  const available = channels.filter((c) => !inPool.has(c.id));
  const nameOf = (id: string) => channels.find((c) => c.id === id)?.name ?? 'Unknown channel';

  const setChannel = (id: string, patch: Partial<{ receives: boolean; sells: boolean }>) =>
    onChange({ ...draft, channels: draft.channels.map((c) => (c.salesChannelId === id ? { ...c, ...patch } : c)) });

  // Checked here as well as on the server so the reason is given before the save, not after it.
  const problem = !draft.name.trim() ? 'Give the pool a name.'
    : draft.channels.length === 0 ? 'Add the channels that share the stock.'
    : !draft.channels.some((c) => c.receives) ? 'At least one channel must receive stock, or the pool has no cost to share.'
    : !draft.channels.some((c) => c.sells) ? 'At least one channel must sell from the pool, or nothing will use it.'
    : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[86vh] w-[620px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">{draft.id ? 'Edit fulfilment pool' : 'New fulfilment pool'}</h2>
          <p className="mt-0.5 text-[12.5px] text-n-500">Channels that share one body of inbound stock.</p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-[1fr_140px_140px] gap-3">
            <div>
              <label className="label">Name</label>
              <input autoFocus className="input" value={draft.name} placeholder="Pan-European FBA" onChange={(e) => onChange({ ...draft, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Effective from</label>
              <input type="date" className="input" value={draft.effectiveFrom} onChange={(e) => onChange({ ...draft, effectiveFrom: e.target.value })} />
            </div>
            <div>
              <label className="label">Effective to</label>
              <input type="date" className="input" value={draft.effectiveTo} onChange={(e) => onChange({ ...draft, effectiveTo: e.target.value })} />
            </div>
          </div>
          <p className="mt-1.5 text-[12px] text-n-500">
            Dates are judged against the order date. Leave them empty to apply to every order; set a
            start date and orders from before you enrolled keep the figure that was true for them.
          </p>

          <div className="mt-5">
            <label className="label">Channels in the pool</label>
            {draft.channels.length === 0 ? (
              <div className="rounded-md border border-dashed border-n-200 py-6 text-center text-[12.5px] text-n-400">No channels yet.</div>
            ) : (
              <div className="overflow-hidden rounded-md border border-n-200">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-n-200 bg-n-50 text-left text-[11.5px] uppercase tracking-wide text-n-500">
                      <th className="px-3 py-2 font-medium">Channel</th>
                      <th className="w-[130px] px-3 py-2 font-medium" title="Inbound shipments to this channel feed the pool's cost">Receives stock</th>
                      <th className="w-[130px] px-3 py-2 font-medium" title="Orders on this channel draw the pool's average cost">Sells from pool</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.channels.map((c) => (
                      <tr key={c.salesChannelId} className="border-b border-n-100 last:border-0">
                        <td className="px-3 py-2 text-[13px] text-n-800">{nameOf(c.salesChannelId)}</td>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={c.receives} onChange={(e) => setChannel(c.salesChannelId, { receives: e.target.checked })} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={c.sells} onChange={(e) => setChannel(c.salesChannelId, { sells: e.target.checked })} />
                        </td>
                        <td className="px-2 py-2">
                          <button className="icon-btn text-danger" title="Remove from pool"
                            onClick={() => onChange({ ...draft, channels: draft.channels.filter((x) => x.salesChannelId !== c.salesChannelId) })}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-2 flex items-center gap-2">
              <Select
                dense className="w-64"
                value={adding}
                onChange={(v) => {
                  if (!v) return;
                  onChange({ ...draft, channels: [...draft.channels, { salesChannelId: v, receives: false, sells: true }] });
                  setAdding('');
                }}
                options={[{ value: '', label: 'Add a channel…' }, ...available.map((c) => ({ value: c.id, label: c.name }))]}
              />
              <span className="text-[12px] text-n-400">{available.length} channel(s) not in this pool</span>
            </div>
          </div>

          <label className="mt-5 flex items-center gap-2 text-[13px] text-n-700">
            <input type="checkbox" checked={draft.active} onChange={(e) => onChange({ ...draft, active: e.target.checked })} />
            Active — costs are shared across this pool
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-n-200 px-5 py-3.5">
          <span className="text-[12.5px] text-danger">{problem ?? ''}</span>
          <div className="flex items-center gap-2">
            <button className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50" onClick={onClose}>Cancel</button>
            <button className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
              disabled={busy || !!problem} onClick={onSave}>{busy ? 'Saving…' : 'Save pool'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
