import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, CheckCircle2, Download, ListChecks, Pencil, Plug, Plus, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { integrationsApi, type ChannelIntegration } from '../lib/api';
import { IntegrationModal } from '../components/integrations/IntegrationModal';
import { MappingVerifyModal } from '../components/integrations/MappingVerifyModal';
import { BackfillModal } from '../components/integrations/BackfillModal';

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
  const [mapVerify, setMapVerify] = useState<ChannelIntegration | undefined>(undefined);
  const [backfill, setBackfill] = useState<ChannelIntegration | undefined>(undefined);

  const { data: integrations = [], isLoading } = useQuery({ queryKey: ['integrations'], queryFn: () => integrationsApi.list() });
  const del = useMutation({
    mutationFn: (id: string) => integrationsApi.remove(id),
    onSuccess: () => { toast.success('Integration removed'); qc.invalidateQueries({ queryKey: ['integrations'] }); },
  });
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const sync = useMutation({
    mutationFn: (id: string) => integrationsApi.sync(id),
    onMutate: (id) => setSyncingId(id),
    onSuccess: (res) => {
      if (res.ok) toast.success(`Sync complete — ${res.created} created, ${res.updated} updated${res.cancelled ? `, ${res.cancelled} cancelled skipped` : ''}`);
      else toast.error(res.message ?? 'Sync failed');
      qc.invalidateQueries({ queryKey: ['integrations'] });
      qc.invalidateQueries({ queryKey: ['sales-transactions'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Sync failed'),
    onSettled: () => setSyncingId(null),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const canSync = (i: ChannelIntegration) => !!i.mappingVerifiedAt && !!i.targetSalesChannelId && !!i.targetCompanyId && i.status === 'active';

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

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-n-100 pt-2.5 text-[12px]">
                {i.lastTestStatus === 'ok' && <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={13} /> Connection OK</span>}
                {i.lastTestStatus === 'fail' && <span className="inline-flex items-center gap-1 text-danger" title={i.lastTestMessage ?? undefined}><XCircle size={13} /> Test failed</span>}
                {!i.lastTestStatus && <span className="text-n-400">Not tested yet</span>}
                {i.mappingVerifiedAt
                  ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={13} /> Mapping verified</span>
                  : <span className="inline-flex items-center gap-1 text-n-400"><ListChecks size={13} /> Mapping not verified</span>}
                {i.autoSyncEnabled && <span className="inline-flex items-center gap-1 text-teal-700"><RefreshCw size={12} /> daily</span>}
                <button className="ml-auto inline-flex items-center gap-1 font-medium text-teal-700 hover:underline" onClick={() => setMapVerify(i)}>
                  <ListChecks size={13} /> {i.mappingVerifiedAt ? 'Review mapping' : 'Verify field mapping'}
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canSync(i) || (sync.isPending && syncingId === i.id)}
                  title={canSync(i) ? 'Pull orders now' : 'Verify the mapping and set the target channel/company first'}
                  onClick={() => sync.mutate(i.id)}
                >
                  <Download size={14} className={sync.isPending && syncingId === i.id ? 'animate-pulse' : ''} /> {sync.isPending && syncingId === i.id ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-medium text-n-700 hover:border-n-300 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canSync(i)}
                  title={canSync(i) ? 'Import all orders in a past date range' : 'Verify the mapping and set the target channel/company first'}
                  onClick={() => setBackfill(i)}
                >
                  <CalendarRange size={14} /> Pull older orders
                </button>
                {i.lastSyncStatus === 'ok' && <span className="text-n-500">{i.lastSyncMessage}</span>}
                {i.lastSyncStatus === 'error' && <span className="text-danger" title={i.lastSyncMessage ?? undefined}>Last sync failed</span>}
                <span className="ml-auto text-n-400">{i.lastSyncRunAt ? `synced ${fmtDateTime(i.lastSyncRunAt)}` : 'never synced'}</span>
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
      {mapVerify && (
        <MappingVerifyModal
          integration={mapVerify}
          onClose={() => setMapVerify(undefined)}
          onVerified={() => { setMapVerify(undefined); invalidate(); }}
        />
      )}
      {backfill && (
        <BackfillModal
          integration={backfill}
          onClose={() => setBackfill(undefined)}
          onDone={() => { invalidate(); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); }}
        />
      )}
    </div>
  );
}
