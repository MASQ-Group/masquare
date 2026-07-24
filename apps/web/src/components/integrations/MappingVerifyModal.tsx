import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { integrationsApi, type ChannelIntegration, type MappedField } from '../../lib/api';

interface Props {
  integration: ChannelIntegration;
  onClose: () => void;
  onVerified: () => void;
}

/** First-run field-mapping verification: shows how the marketplace's fields map
 *  to a maSquare sales transaction, against the user's real sample data, and lets
 *  them confirm before any import runs. */
export function MappingVerifyModal({ integration, onClose, onVerified }: Props) {
  const [sampleIdx, setSampleIdx] = useState(0);
  const { data, isLoading } = useQuery({
    queryKey: ['mapping-preview', integration.id],
    queryFn: () => integrationsApi.previewMapping(integration.id),
  });

  const verify = useMutation({
    mutationFn: () => integrationsApi.verifyMapping(integration.id, true),
    onSuccess: () => { toast.success('Field mapping confirmed — import can now run'); onVerified(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const samples = data?.samples ?? [];
  const sample = samples[sampleIdx];
  const alreadyVerified = !!integration.mappingVerifiedAt;

  const itemFieldRows = useMemo(() => {
    // Build a table: one row per target field, one column per SKU line.
    if (!sample || sample.items.length === 0) return [];
    const targets = sample.items[0].fields.map((f) => ({ target: f.target, label: f.label, source: f.source }));
    return targets.map((t) => ({ ...t, values: sample.items.map((it) => it.fields.find((f) => f.target === t.target)?.value ?? null) }));
  }, [sample]);

  return (
    <ModalShell
      open
      title="Verify Field Mapping"
      subtitle={[integration.connectorLabel, integration.marketplaceLabel].filter(Boolean).join(' · ')}
      initialSize={{ w: 860, h: 680 }}
      primaryLabel={alreadyVerified ? 'Re-confirm mapping' : 'Confirm mapping is correct'}
      onPrimary={() => verify.mutate()}
      primaryDisabled={!data?.ok || verify.isPending}
      busy={verify.isPending}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-2 rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
          <ArrowRight size={15} className="mt-0.5 shrink-0" />
          This shows how each <strong>{integration.connectorLabel}</strong> field maps into a maSquare <strong>sales transaction</strong>, using your real sample orders. Confirm it looks right before importing — nothing is stored yet.
        </p>

        {isLoading && <div className="py-12 text-center text-[13px] text-n-500">Fetching sample orders…</div>}

        {!isLoading && data && !data.ok && (
          <div className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> Could not fetch sample orders{data.status ? ` (${data.status})` : ''}. {data.message}
          </div>
        )}

        {!isLoading && data?.ok && samples.length === 0 && (
          <div className="rounded-md border border-warning-bd bg-warning-bg px-3 py-2.5 text-[13px] text-warning">No recent orders to preview. Try again once there are orders on this marketplace.</div>
        )}

        {sample && (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[12px] font-medium text-n-500">Sample order</span>
              <Select
                dense
                className="w-40"
                value={String(sampleIdx)}
                onChange={(v) => setSampleIdx(Number(v))}
                options={samples.map((s, i) => ({ value: String(i), label: s.orderId }))}
              />
              <span className="rounded-pill bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">{data?.mode === 'live' ? 'live data' : 'test data'}</span>
              {alreadyVerified && <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success"><CheckCircle2 size={13} /> Previously verified</span>}
            </div>

            {/* Header mapping */}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">Transaction header</div>
              <MapTable rows={sample.header.map((f) => ({ label: f.label, target: f.target, source: f.source, cells: [displayValue(f)] }))} valueHeaders={['Value']} />
            </div>

            {/* Item (SKU line) mapping */}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">Line items ({sample.items.length} SKU{sample.items.length === 1 ? '' : 's'})</div>
              <MapTable
                rows={itemFieldRows.map((r) => ({ label: r.label, target: r.target, source: r.source, cells: r.values.map((v) => (v == null ? '—' : String(v))) }))}
                valueHeaders={sample.items.map((it) => it.sku ?? '—')}
              />
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

function displayValue(f: MappedField): string {
  if (f.value == null || f.value === '') return '—';
  return f.resolved ? `${f.value} → ${f.resolved}` : String(f.value);
}

function MapTable({ rows, valueHeaders }: { rows: { label: string; target: string; source: string; cells: string[] }[]; valueHeaders: string[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-n-200">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-n-500">maSquare field</th>
              <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-n-500">Source</th>
              {valueHeaders.map((h, i) => (
                <th key={i} className="border-b border-n-200 bg-n-25 px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.target}>
                <td className="border-b border-n-100 px-3 py-1.5 font-medium text-n-800 whitespace-nowrap">{r.label}</td>
                <td className="mono border-b border-n-100 px-3 py-1.5 text-[11.5px] text-n-500">{r.source}</td>
                {r.cells.map((c, i) => <td key={i} className="mono border-b border-n-100 px-3 py-1.5 text-right text-n-700 whitespace-nowrap">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
