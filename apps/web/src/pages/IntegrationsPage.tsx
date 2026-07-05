import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Plug, Plus, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { integrationsApi, type ChannelIntegration } from '../lib/api';
import { IntegrationModal } from '../components/integrations/IntegrationModal';

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Group integrations by channel family (Amazon / eBay / OnBuy), preserving order. */
function groupByFamily(rows: ChannelIntegration[]): [string, ChannelIntegration[]][] {
  const map = new Map<string, ChannelIntegration[]>();
  for (const r of rows) { if (!map.has(r.channelType)) map.set(r.channelType, []); map.get(r.channelType)!.push(r); }
  return [...map.entries()];
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<ChannelIntegration | null | undefined>(undefined); // null = new, obj = edit

  const { data: integrations = [], isLoading } = useQuery({ queryKey: ['integrations'], queryFn: () => integrationsApi.list() });
  const del = useMutation({
    mutationFn: (id: string) => integrationsApi.remove(id),
    onSuccess: () => { toast.success('Integration removed'); qc.invalidateQueries({ queryKey: ['integrations'] }); },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations'] });

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex-1">
          <div className="eyebrow mb-1.5">Operations</div>
          <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Channel integrations</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-n-500">Connect sales channels to pull data automatically. API keys are encrypted and never leave the platform.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal(null)}><Plus size={17} /> Add integration</button>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-md border border-teal-100 bg-teal-50/60 px-3.5 py-2.5 text-[12.5px] text-n-700">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-teal-600" />
        <span>Consumer/secret keys are encrypted at rest (AES-256-GCM) with a key held outside the database, are write-only (never shown again), and are decrypted only in memory when calling the channel's API.</span>
      </div>

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading…</div>}
      {!isLoading && integrations.length === 0 && (
        <div className="card flex flex-col items-center gap-3 py-14 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-n-100 text-n-400"><Plug size={22} /></div>
          <div className="text-[14px] font-medium text-n-700">No integrations yet</div>
          <p className="max-w-sm text-[12.5px] text-n-500">Add your first channel integration to start pulling sales and inventory data automatically.</p>
          <button className="btn btn-ghost" onClick={() => setModal(null)}><Plus size={16} /> Add integration</button>
        </div>
      )}

      {!isLoading && integrations.length > 0 && (
        <div className="flex flex-col gap-6">
          {groupByFamily(integrations).map(([family, rows]) => (
            <div key={family}>
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-n-500">
                {rows[0].connectorLabel} <span className="rounded-pill bg-n-100 px-1.5 text-[11px] font-medium text-n-500">{rows.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 max-[820px]:grid-cols-1">
          {rows.map((i) => (
            <div key={i.id} className="card p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700"><Plug size={18} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] font-semibold text-n-900">{i.name}</span>
                    {i.marketplaceLabel && <span className="tag border border-n-200 bg-n-50 text-n-600">{i.marketplace}</span>}
                    <span className={`tag ${i.status === 'active' ? 'border border-teal-100 bg-teal-50 text-teal-700' : 'border border-n-200 bg-n-100 text-n-500'}`}>{i.status}</span>
                  </div>
                  <div className="text-[12.5px] text-n-500">{[i.connectorLabel, i.marketplaceLabel].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="flex gap-1">
                  <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" title="Edit" onClick={() => setModal(i)}><Pencil size={15} /></button>
                  <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" title="Remove" onClick={() => confirm(`Remove integration “${i.name}”? Stored keys will be deleted.`) && del.mutate(i.id)}><Trash2 size={15} /></button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {i.secretFields.map((s) => (
                  <span key={s.fieldKey} className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium ${s.set ? 'bg-teal-50 text-teal-700' : 'bg-n-100 text-n-400'}`} title={s.fieldKey}>
                    {s.fieldKey}: {s.set ? `•••• ${s.last4}` : 'not set'}
                  </span>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-n-100 pt-2.5 text-[12px]">
                {i.lastTestStatus === 'ok' && <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={13} /> Connection OK</span>}
                {i.lastTestStatus === 'fail' && <span className="inline-flex items-center gap-1 text-danger" title={i.lastTestMessage ?? undefined}><XCircle size={13} /> Test failed</span>}
                {!i.lastTestStatus && <span className="text-n-400">Not tested yet</span>}
                <span className="ml-auto text-n-400">{i.lastTestedAt ? fmtDateTime(i.lastTestedAt) : ''}</span>
              </div>
            </div>
          ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal !== undefined && (
        <IntegrationModal
          integration={modal ?? undefined}
          onClose={() => setModal(undefined)}
          onSaved={() => { setModal(undefined); invalidate(); }}
        />
      )}
    </div>
  );
}
