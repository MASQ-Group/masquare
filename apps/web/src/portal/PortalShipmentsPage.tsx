import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, PackagePlus, Search } from 'lucide-react';
import { portalApi, type PortalShipment } from '../lib/api';

/**
 * A customer's own shipments.
 *
 * Newest first — the opposite of our queue, and for a good reason: ours is work to be done and is
 * taken from the front, theirs is a record of what they sent and the useful end is the recent one.
 *
 * Status is said in their terms rather than ours. "SUBMITTED" means nothing to somebody who filed a
 * parcel; "With maSquare" does.
 */
export function PortalShipmentsPage({ view = 'active' }: { view?: 'active' | 'archived' }) {
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useQuery({
    queryKey: ['portal', 'shipments', view, q],
    queryFn: () => portalApi.list({ view, q: q.trim() || undefined }),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[18px] font-semibold text-n-900">{view === 'archived' ? 'Archived shipments' : 'Shipments in progress'}</h1>
        <div className="flex h-9 flex-[0_1_300px] items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-3 focus-within:border-teal-400">
          <Search size={15} className="text-n-400" />
          <input
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            placeholder="Search reference, recipient or tracking…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex-1" />
        {view === 'active' && (
          <Link to="/portal/new" className="hbtn-primary"><PackagePlus size={16} /> New shipment</Link>
        )}
      </div>

      {isLoading ? (
        <p className="text-[13px] text-n-500">Loading…</p>
      ) : data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-n-200 bg-n-0 p-10 text-center">
          <p className="text-[13.5px] text-n-600">
            {q
              ? 'Nothing matches that.'
              : view === 'archived'
                ? 'Nothing archived yet. A shipment you have finished with can be archived from its page.'
                : 'No shipments yet.'}
          </p>
          {view === 'active' && !q && (
            <Link to="/portal/new" className="btn btn-primary mt-4 inline-flex">
              <PackagePlus size={16} /> File your first shipment
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {data.map((s) => <ShipmentCard key={s.id} shipment={s} />)}
        </div>
      )}
    </div>
  );
}

/**
 * One shipment, as a card rather than a table row.
 *
 * A row of fifteen columns is how our team reads a queue; a customer reads one shipment at a time
 * and wants the reference, where it is going and what is happening to it — which fits a card and
 * stays readable on a telephone, where a good deal of this will be used.
 */
function ShipmentCard({ shipment: s }: { shipment: PortalShipment }) {
  const state = portalStatus(s);
  const to = [s.recipient.companyName || s.recipient.contactName, s.address.city, s.address.countryIso].filter(Boolean).join(', ');
  const weight = s.packages.reduce((n, p) => n + Number(p.weightKg ?? 0), 0);

  return (
    <Link to={`/portal/${s.id}`} className="card block p-4 transition-colors hover:border-n-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-[14px] font-semibold text-n-900">{s.reference}</span>
        {s.orderReference && <span className="mono text-[12px] text-n-500">{s.orderReference}</span>}
        <span className={`tag ${state.tone}`}>{state.label}</span>
        <div className="flex-1" />
        <span className="text-[12px] text-n-500">{new Date(s.createdAt).toLocaleDateString()}</span>
      </div>

      <div className="mt-1.5 text-[13px] text-n-700">{to || 'No recipient yet'}</div>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-n-500">
        <span>{s.packages.length} package{s.packages.length === 1 ? '' : 's'} · {weight.toFixed(2)} kg</span>
        {s.carrier && <span>{s.carrier}</span>}
        {s.trackingNumber && (
          <span className="mono inline-flex items-center gap-1 text-teal-700">
            {s.trackingNumber}{s.trackingUrl && <ExternalLink size={11} />}
          </span>
        )}
        {s.charge && <span className="text-n-700">Charged {s.charge.currency === 'EUR' ? '€' : `${s.charge.currency} `}{s.charge.amount.toFixed(2)}</span>}
      </div>

      {/* The one thing on this screen somebody must act on. */}
      {s.status === 'NEEDS_INFO' && s.infoRequest && (
        <p className="mt-2 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          maSquare asked: {s.infoRequest}
        </p>
      )}
      {s.tracking?.exception && (
        <p className="mt-2 text-[12.5px] text-warning">{s.tracking.exception}</p>
      )}
    </Link>
  );
}

/** Our states, said in the words of somebody who sent a parcel rather than somebody who books them. */
export function portalStatus(s: PortalShipment): { label: string; tone: string } {
  if (s.status === 'CANCELLED') return { label: 'Cancelled', tone: 'bg-n-100 text-n-600' };
  if (s.status === 'NEEDS_INFO') return { label: 'Needs your answer', tone: 'bg-warning-bg text-warning' };
  if (s.status === 'SUBMITTED') return { label: 'With maSquare', tone: 'bg-info-bg text-info' };
  if (s.tracking?.deliveredAt) return { label: 'Delivered', tone: 'bg-teal-50 text-teal-700' };
  if (s.status === 'ARCHIVED') return { label: 'Archived', tone: 'bg-n-100 text-n-600' };
  return { label: s.tracking?.status ?? 'On its way', tone: 'bg-teal-50 text-teal-700' };
}
