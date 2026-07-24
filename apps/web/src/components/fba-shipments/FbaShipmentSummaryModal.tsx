import { Boxes, ExternalLink, Lock } from 'lucide-react';
import { ModalShell } from '@masquare/ui';
import { type FbaShipment } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { buildTrackingUrl } from '../../lib/tracking';

interface Props {
  shipment: FbaShipment;
  /** Whether this user may edit (false for confirmed shipments when not an admin). */
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onRegisterActual: () => void;
}

const eur = (v: number | null | undefined, dp = 2) => (v != null ? `€${v.toFixed(dp)}` : '—');
const kg = (v: number | null | undefined) => (v != null ? `${v.toFixed(3)} kg` : '—');

/** Read-only summary of an FBA shipment, opened from the list. Edit is gated for
 *  confirmed shipments (admins only). */
export function FbaShipmentSummaryModal({ shipment: s, canEdit, onClose, onEdit, onRegisterActual }: Props) {
  const isActual = s.costSource === 'actual';
  const template = s.shippingService?.trackingUrlTemplate;

  return (
    <ModalShell
      open
      title="FBA Shipment Summary"
      subtitle={[s.fbaShipmentRef, s.salesChannel?.name, s.destinationCountry?.name].filter(Boolean).join(' · ') || undefined}
      initialSize={{ w: 900, h: 660 }}
      primaryLabel={canEdit ? 'Edit shipment' : 'Edit (admins only)'}
      onPrimary={onEdit}
      primaryDisabled={!canEdit}
      secondaryLabel="Register actual cost"
      onSecondary={onRegisterActual}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-4 gap-x-4 gap-y-3 max-[760px]:grid-cols-2">
          <Fact label="Date" value={formatDate(s.date)} mono />
          <Fact label="FBA Shipment ID" value={s.fbaShipmentRef ?? '—'} mono />
          <div>
            <div className="text-[11px] text-n-500">Status</div>
            <div className="mt-0.5">
              {s.status === 'confirmed'
                ? <span className="tag inline-flex items-center gap-1 border border-teal-100 bg-teal-50 text-teal-700"><Lock size={11} /> Confirmed</span>
                : <span className="tag border border-n-200 bg-n-100 text-n-600">Draft</span>}
            </div>
          </div>
          <Fact label="Calc method" value={s.calcMethod === 'actual_weight' ? 'Actual weight' : s.calcMethod === 'volumetric_weight' ? 'Volumetric' : '—'} />
          <Fact label="Sales channel" value={s.salesChannel?.name ?? '—'} />
          <Fact label="Destination" value={s.destinationCountry?.name ?? '—'} />
          <Fact label="Shipping service" value={s.shippingService?.name ?? '—'} />
          <Fact label="Shipping zone" value={s.shippingZone?.name ?? '—'} />
        </div>

        {/* Cost & weight */}
        <div className="rounded-lg border border-n-200 bg-n-25 p-3">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">Shipping cost & weight</div>
          <div className="grid grid-cols-4 gap-3 max-[760px]:grid-cols-2">
            <Fact label="Product weight" value={kg(s.productWeightKg)} mono />
            <Fact label="Empty boxes weight" value={kg(s.emptyBoxesWeightKg)} mono />
            <Fact label="Chargeable weight" value={kg(s.chargeableWeightKg)} mono />
            <div>
              <div className="text-[11px] text-n-500">Estimated cost</div>
              <div className="mono text-[13.5px] font-medium text-n-800">{eur(s.estimatedCostEur)}</div>
            </div>
            <div>
              <div className="text-[11px] text-n-500">Actual cost {isActual ? <span className="font-semibold text-teal-700">· registered</span> : <span className="text-n-400">· not set</span>}</div>
              <div className="mono text-[15px] font-semibold text-n-900">{eur(s.actualCostEur)}</div>
            </div>
            <div>
              <div className="text-[11px] text-n-500">Cost used (effective)</div>
              <div className="mono text-[13.5px] font-semibold" style={{ color: '#14A79D' }}>{eur(s.effectiveCostEur)} <span className="text-[10.5px] font-normal text-n-400">· {isActual ? 'actual' : 'estimated'}</span></div>
            </div>
          </div>
        </div>

        {/* Boxes */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-n-500">Boxes ({s.boxCount})</div>
          <div className="flex flex-col gap-2">
            {s.boxes.map((b, i) => {
              const url = buildTrackingUrl(template, b.trackingNumber);
              return (
                <div key={b.id ?? i} className="rounded-lg border border-n-200 p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-n-800"><Boxes size={14} className="text-teal-600" /> {b.label ?? `Box ${i + 1}`}</span>
                    <span className="text-n-500">empty <span className="mono text-n-700">{kg(b.emptyWeightKg)}</span></span>
                    <span className="text-n-500">dims <span className="mono text-n-700">{b.lengthCm ?? '—'}×{b.widthCm ?? '—'}×{b.heightCm ?? '—'} cm</span></span>
                    {b.volumetricWeightKg != null && <span className="text-n-500">vol <span className="mono text-n-700">{kg(b.volumetricWeightKg)}</span></span>}
                    <span className="text-n-500">
                      tracking{' '}
                      {b.trackingNumber
                        ? (url
                            ? <a href={url} target="_blank" rel="noreferrer" className="code inline-flex items-center gap-0.5 font-medium text-teal-700 hover:underline">{b.trackingNumber}<ExternalLink size={11} /></a>
                            : <span className="code text-n-700">{b.trackingNumber}</span>)
                        : <span className="text-n-400">—</span>}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {b.items.map((it, j) => (
                      <span key={it.id ?? j} className="mono inline-flex items-center gap-1 rounded bg-n-100 px-1.5 py-0.5 text-[11px] text-n-600" title={it.title ?? undefined}>
                        {it.sku} <span className="text-n-400">×{it.quantity}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Allocation */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-n-500">
            Cost allocation <span className="font-normal normal-case text-n-400">· {isActual ? 'actual cost' : 'estimated cost'}, split by weight then per unit</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-n-200">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {['SKU', 'Qty', 'Weight', 'Allocated', 'Per unit'].map((h, i) => (
                    <th key={h} className={`border-b border-n-200 bg-n-25 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-n-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.allocation.map((it, i) => (
                  <tr key={i}>
                    <td className="code border-b border-n-100 px-3 py-2 text-n-800" title={it.title ?? undefined}>{it.sku}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-600">{it.quantity}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-600">{kg(it.lineWeightKg)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{eur(it.allocatedCostEur)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right font-semibold text-n-900">{eur(it.allocatedCostPerUnitEur)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="bg-n-25 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-n-500">Total</td>
                  <td className="mono bg-n-25 px-3 py-2 text-right text-[13px] font-semibold text-n-800">{s.quantity}</td>
                  <td className="bg-n-25" />
                  <td className="mono bg-n-25 px-3 py-2 text-right text-[13px] font-semibold text-n-900">{eur(s.effectiveCostEur)}</td>
                  <td className="bg-n-25" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {s.comments && <div><div className="text-[11px] text-n-500">Comments</div><div className="text-[13px] text-n-700">{s.comments}</div></div>}
      </div>
    </ModalShell>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-n-500">{label}</div>
      <div className={`truncate text-[13.5px] font-medium text-n-800 ${mono ? 'mono' : ''}`}>{value}</div>
    </div>
  );
}
