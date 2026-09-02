import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, FileSpreadsheet, Package, Receipt, RefreshCw, Search, User, X } from 'lucide-react';
import { Pagination, Select } from '@masquare/ui';
import { activityApi, type ActivityListEntry } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';

/**
 * What happened across the platform, and who did it.
 *
 * The per-record History tabs answer "what happened to this"; this answers "what happened today",
 * which is the question asked when something is wrong but nobody yet knows where.
 *
 * It opens on people's actions rather than everything. Machines outnumber them by orders of
 * magnitude — one sync writes more rows in a night than a person does in a year — so a feed that
 * defaults to all of it buries the one human action anybody came looking for. Machine entries are
 * one filter away, never hidden.
 */

const SOURCE = {
  user: { icon: User, label: 'Person', className: 'text-teal-700 bg-teal-50 border-teal-200' },
  import: { icon: FileSpreadsheet, label: 'Spreadsheet', className: 'text-info bg-info-50 border-info-200' },
  sync: { icon: RefreshCw, label: 'Channel sync', className: 'text-n-600 bg-n-50 border-n-200' },
  system: { icon: Bot, label: 'Platform', className: 'text-n-600 bg-n-50 border-n-200' },
} as const;

const ACTION_LABEL: Record<string, string> = { create: 'Created', update: 'Edited', delete: 'Deleted', restore: 'Restored' };

/** How each entity type reads, and where clicking it goes. */
const ENTITY = {
  product: { label: 'Product', icon: Package, href: (id: string) => `/products?edit=${id}` },
  salesTransaction: { label: 'Order', icon: Receipt, href: (id: string) => `/sales-transactions?open=${id}` },
} as const;

const when = (iso: string) => new Date(iso).toLocaleString(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const WHO = [
  { value: 'people', label: 'People' },
  { value: 'machines', label: 'Syncs & jobs' },
  { value: 'all', label: 'Everyone' },
];

export function ActivityPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [who, setWho] = useState('people');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const pageSize = 50;

  const params = { page, pageSize, who, entityType, action, actorId, from, to, search };
  const { data, isLoading } = useQuery({ queryKey: ['activity', params], queryFn: () => activityApi.list(params) });
  const { data: facets } = useQuery({ queryKey: ['activity-facets'], queryFn: () => activityApi.facets() });

  const reset = (fn: () => void) => { fn(); setPage(1); };
  const anyFilter = who !== 'people' || !!entityType || !!action || !!actorId || !!from || !!to || !!search;
  const clearAll = () => {
    setWho('people'); setEntityType(''); setAction(''); setActorId(''); setFrom(''); setTo('');
    setSearchInput(''); setSearch(''); setPage(1);
  };

  // Group by calendar day so a long feed reads as a diary rather than an undifferentiated list.
  const days = useMemo(() => {
    const out: { day: string; items: ActivityListEntry[] }[] = [];
    for (const it of data?.items ?? []) {
      const day = new Date(it.createdAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(it);
    }
    return out;
  }, [data?.items]);

  return (
    <div className="w-full">
      <PageHeader
        module="Platform"
        title="Activity"
        info="Every change to a product or an order, with what it was before."
        summary={data ? `${data.total.toLocaleString()} entr${data.total === 1 ? 'y' : 'ies'}` : ''}
      />

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
          <input
            className="input h-9 w-[240px] pl-9"
            placeholder="SKU or order reference…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') reset(() => setSearch(searchInput)); }}
            onBlur={() => reset(() => setSearch(searchInput))}
          />
        </div>
        <Labelled label="Who">
          <Select value={who} onChange={(v) => reset(() => setWho(v))} options={WHO.map((w) => ({ value: w.value, label: w.label }))} />
        </Labelled>
        <Labelled label="What">
          <Select
            value={entityType}
            onChange={(v) => reset(() => setEntityType(v))}
            placeholder="Anything"
            options={(facets?.entityTypes ?? []).map((t) => ({ value: t, label: ENTITY[t as keyof typeof ENTITY]?.label ?? t }))}
          />
        </Labelled>
        <Labelled label="Action">
          <Select
            value={action}
            onChange={(v) => reset(() => setAction(v))}
            placeholder="Any"
            options={['create', 'update', 'delete'].map((a) => ({ value: a, label: ACTION_LABEL[a] }))}
          />
        </Labelled>
        <Labelled label="By">
          <Select
            value={actorId}
            onChange={(v) => reset(() => setActorId(v))}
            placeholder="Anyone"
            options={(facets?.actors ?? []).map((a) => ({ value: a!.id, label: a!.fullName }))}
          />
        </Labelled>
        <Labelled label="From">
          <input type="date" className="input h-9 w-[150px]" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
        </Labelled>
        <Labelled label="To">
          <input type="date" className="input h-9 w-[150px]" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
        </Labelled>
        {anyFilter && (
          <button className="btn btn-ghost h-9" onClick={clearAll}><X size={14} /> Clear</button>
        )}
      </div>

      {isLoading ? (
        <div className="card mt-5 px-4 py-20 text-center text-[13px] text-n-500">Loading…</div>
      ) : days.length === 0 ? (
        <div className="card mt-5 px-4 py-20 text-center">
          <div className="text-[13.5px] font-medium text-n-700">Nothing to show</div>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-n-500">
            {anyFilter
              ? 'No activity matches these filters.'
              : 'Changes are recorded from the point this feature went live. Nothing has been edited since.'}
          </p>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-6">
          {days.map(({ day, items }) => (
            <div key={day}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-n-500">{day}</div>
              <div className="flex flex-col gap-2">
                {items.map((a) => {
                  const src = SOURCE[a.source as keyof typeof SOURCE] ?? SOURCE.system;
                  const Icon = src.icon;
                  const ent = ENTITY[a.entityType as keyof typeof ENTITY];
                  const EntIcon = ent?.icon;
                  return (
                    <div key={a.id} className="rounded-lg border border-n-200 bg-n-0 px-4 py-3">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span className="text-[13.5px] font-semibold text-n-900">{ACTION_LABEL[a.action] ?? a.action}</span>
                        {/* The label is the SKU or order reference. A deleted record keeps its
                            label but has nowhere to go, so it is not a link. */}
                        {a.entityLabel && (a.action === 'delete' || !ent ? (
                          <span className="mono text-[13px] text-n-600">{a.entityLabel}</span>
                        ) : (
                          <button
                            className="mono inline-flex items-center gap-1 text-[13px] font-medium text-teal-700 hover:underline"
                            onClick={() => navigate(ent.href(a.entityId))}
                          >
                            {EntIcon && <EntIcon size={12} />} {a.entityLabel}
                          </button>
                        ))}
                        <span className="text-[13px] text-n-600">by {a.actor?.name ?? 'the platform'}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] font-medium ${src.className}`}>
                          <Icon size={11} /> {src.label}
                        </span>
                        <div className="flex-1" />
                        <span className="mono text-[12px] text-n-500">{when(a.createdAt)}</span>
                      </div>

                      {a.action !== 'update' && a.summary && (
                        <div className="mt-1 text-[12.5px] text-n-600">{a.summary}</div>
                      )}

                      {a.changes.length > 0 && (
                        <div className="mt-2 flex flex-col gap-0.5">
                          {a.changes.map((c, i) => (
                            <div key={`${c.field}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                              <span className="text-n-500">{c.label}</span>
                              <span className="text-n-400 line-through">{c.from ?? '—'}</span>
                              <span className="text-n-300">→</span>
                              <span className="font-medium text-n-800">{c.to ?? '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {(data?.total ?? 0) > pageSize && (
            <Pagination page={page} pageCount={Math.ceil((data?.total ?? 0) / pageSize)} onPageChange={setPage} />
          )}
        </div>
      )}
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="mb-1 text-[11px] font-semibold text-n-500">{label}</span>
      {children}
    </div>
  );
}
